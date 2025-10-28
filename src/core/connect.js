import { BOT_CONFIG } from "#config/index";
import Message from "#core/message";
import getAuthState from "#lib/auth/state";
import logger from "#lib/logger";
import PluginManager from "#lib/plugins";
import print from "#lib/print";
import { Client } from "#lib/serialize";
import Store from "#lib/store";
import NodeCache from "@cacheable/node-cache";
import {
	Browsers,
	DisconnectReason,
	fetchLatestBaileysVersion,
	getAggregateVotesInPollMessage,
	jidNormalizedUser,
	makeCacheableSignalKeyStore,
	makeWASocket,
} from "baileys";
import qrcode from "qrcode";

const msgRetryCounterCache = new NodeCache();

/**
 * Main class to manage the WhatsApp bot connection and events.
 */
class Connect {
	constructor() {
		this.sock = null;
		this.sessionName = BOT_CONFIG.sessionName;

		this.groupMetadataCache = new NodeCache({
			stdTTL: 60 * 60,
			checkperiod: 120,
		});

		this.pluginManager = new PluginManager(BOT_CONFIG);
		this.store = new Store(this.sessionName);
		this.message = new Message(
			this.pluginManager,
			BOT_CONFIG.ownerJids,
			BOT_CONFIG.prefixes,
			this.groupMetadataCache,
			this.store
		);
	}

	/**
	 * Start Baileys connection and manages events.
	 */
	async start() {
		print.info(`Starting WhatsApp Bot session: ${this.sessionName}`);

		await this.store.load();
		this.store.savePeriodically();

		const { state, saveCreds, removeCreds } = await getAuthState(
			this.sessionName
		);

		const qrMode = process.env.QR === "true";
		const botNumber = process.env.BOT_NUMBER;
		let usePairingCode = false;
		if (!state.creds.registered) {
			if (!qrMode) {
				if (!botNumber) {
					print.error(
						"BOT_NUMBER is not set in .env. Please set BOT_NUMBER."
					);
					process.exit(1);
				}
				usePairingCode = true;
			} else {
				usePairingCode = false;
			}
		}

		const { version } = await fetchLatestBaileysVersion();
		print.info(`Baileys version: ${version.join(".")}`);

		await this.pluginManager.loadPlugins();
		this.pluginManager.watchPlugins();

		this.sock = makeWASocket({
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			version,
			logger,
			getMessage: async (key) => {
				const jid = jidNormalizedUser(key.remoteJid);
				return this.store.loadMessage(jid, key.id)?.message || null;
			},
			getGroupMetadata: async (jid) => {
				const normalizedJid = jidNormalizedUser(jid);

				let metadata = this.groupMetadataCache.get(normalizedJid);
				if (metadata) {
					return metadata;
				}

				metadata = this.store.getGroupMetadata(normalizedJid);
				if (metadata) {
					this.groupMetadataCache.set(normalizedJid, metadata);
					return metadata;
				}

				try {
					metadata = await this.sock.groupMetadata(jid);
					this.groupMetadataCache.set(normalizedJid, metadata);
					this.store.setGroupMetadata(normalizedJid, metadata);
					print.debug(`Cached metadata for group: ${jid}`);
					return metadata;
				} catch (e) {
					print.error(
						`Failed to fetch group metadata for ${jid}:`,
						e
					);
					return null;
				}
			},
			browser: Browsers.macOS("Safari"),
			syncFullHistory: false,
			generateHighQualityLinkPreview: true,
			qrTimeout: usePairingCode ? undefined : 60000,
			printQRInTerminal: qrMode,
			msgRetryCounterCache,
		});

		this.sock = Client({ sock: this.sock, store: this.store });

		this.pluginManager.scheduleAllPeriodicTasks(this.sock);

		this.sock.ev.on("creds.update", saveCreds);
		this.sock.ev.on("contacts.update", (update) => {
			this.store.updateContacts(update);
		});
		this.sock.ev.on("contacts.upsert", (update) => {
			this.store.upsertContacts(update);
		});
		this.sock.ev.on("groups.update", (updates) => {
			this.store.updateGroupMetadata(updates);
		});
		this.sock.ev.on("connection.update", async (update) => {
			const { connection, lastDisconnect, qr } = update;

			if (!usePairingCode && qr) {
				print.info(`Scan QR Code for session ${this.sessionName}:`);
				console.log(
					await qrcode.toString(qr, { type: "terminal", small: true })
				);
			}

			if (
				usePairingCode &&
				connection === "connecting" &&
				!state.creds.registered
			) {
				const phoneNumber = botNumber;
				if (phoneNumber) {
					setTimeout(async () => {
						try {
							const code = await this.sock.requestPairingCode(
								phoneNumber.trim()
							);
							print.info(`Your Pairing Code: ${code}`);
							print.info(
								"Enter this code on your WhatsApp phone: Settings -> Linked Devices -> Link a Device -> Link with phone number instead."
							);
						} catch (e) {
							print.error("Failed to request pairing code:", e);
						}
					}, 6000);
				} else {
					print.error(
						"No BOT_NUMBER provided for pairing code. Please set BOT_NUMBER in .env and restart the bot."
					);
					process.exit(1);
				}
			}

			if (connection === "close") {
				const shouldReconnect =
					lastDisconnect?.error?.output?.statusCode !==
					DisconnectReason.loggedOut;
				print.warn(
					`Connection closed for session ${this.sessionName}. Reason: ${lastDisconnect?.error?.message || "Unknown"}. Reconnecting: ${shouldReconnect}`
				);

				if (
					lastDisconnect?.error?.output?.statusCode ===
					DisconnectReason.loggedOut
				) {
					await removeCreds();
					print.info(
						`Session ${this.sessionName} logged out. Credentials removed. Please restart bot to get a new QR code.`
					);
				}

				if (shouldReconnect) {
					setTimeout(() => this.start(), 3000);
				} else {
					this.store.stopSaving();
					process.exit(1);
				}
			} else if (connection === "open") {
				print.info(
					`Connection opened successfully for session ${this.sessionName}.`
				);
			}
		});

		this.sock.ev.on("messages.upsert", (data) =>
			this.message.process(this.sock, data)
		);

		this.sock.ev.on("messages.update", async (event) => {
			for (const { key, update } of event) {
				if (update.pollUpdates) {
					const pollCreation = await this.store.loadMessage(
						jidNormalizedUser(key.remoteJid),
						key.id
					);
					if (pollCreation && pollCreation.message) {
						const aggregate = getAggregateVotesInPollMessage({
							message: pollCreation.message,
							pollUpdates: update.pollUpdates,
						});
						print.info("Got poll update, aggregation:", aggregate);
					}
				}
			}
		});

		this.sock.ev.on(
			"group-participants.update",
			async ({ id, participants, action }) => {
				const participantJids = participants
					.map((p) => (typeof p === "string" ? p : p?.id))
					.filter(Boolean)
					.map(jidNormalizedUser);

				print.info(
					`Group participants updated for ${id}: ${action} ${participantJids.join(", ")}`
				);

				const normalizedJid = jidNormalizedUser(id);
				let metadata =
					this.groupMetadataCache.get(normalizedJid) ||
					this.store.getGroupMetadata(normalizedJid);

				if (!metadata) {
					try {
						metadata = await this.sock.groupMetadata(id);
					} catch (e) {
						print.error(`Failed to fetch metadata for ${id}:`, e);
						return;
					}
				}

				switch (action) {
					case "add":
						participantJids.forEach((pid) => {
							if (
								!metadata.participants.some((p) => p.id === pid)
							) {
								metadata.participants.push({
									id: pid,
									admin: null,
								});
							}
						});
						break;
					case "promote":
						metadata.participants.forEach((p) => {
							if (participantJids.includes(p.id)) {
								p.admin = "admin";
							}
						});
						break;
					case "demote":
						metadata.participants.forEach((p) => {
							if (participantJids.includes(p.id)) {
								p.admin = null;
							}
						});
						break;
					case "remove":
						metadata.participants = metadata.participants.filter(
							(p) => !participantJids.includes(p.id)
						);
						break;
				}

				this.groupMetadataCache.set(normalizedJid, metadata);
				this.store.setGroupMetadata(normalizedJid, metadata);
				print.debug(`Updated group metadata cache for ${id}`);
			}
		);
	}
}

export default Connect;
