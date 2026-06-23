import makeWASocket, {
	DisconnectReason,
	fetchLatestBaileysVersion,
	getAggregateVotesInPollMessage,
	makeCacheableSignalKeyStore,
	proto,
	Browsers,
} from "baileys";
import NodeCache from "@cacheable/node-cache";
import qrcode from "qrcode";
import { BOT_CONFIG } from "#config/index";
import Message from "#core/message";
import getAuthState from "#lib/auth/state";
import logger from "#lib/logger";
import PluginManager from "#lib/plugins";
import print from "#lib/print";
import { Client } from "#lib/serialize";
import Store from "#lib/store";
import {
	getEditPayload,
	getMessageText,
	getSenderKey,
	getUpsertDedupeKey,
	hashString,
	safeNorm,
} from "#utils/message";

/**
 * Cache used by Baileys to track message retry counters.
 * @type {NodeCache}
 */
const msgRetryCounterCache = new NodeCache();

/**
 * Dedupe cache for normal incoming messages from messages.upsert.
 * @type {NodeCache}
 */
const processedUpsertCache = new NodeCache({
	stdTTL: 10 * 60,
	checkperiod: 60,
});

/**
 * Dedupe cache for edited messages from messages.update.
 * @type {NodeCache}
 */
const processedEditCache = new NodeCache({
	stdTTL: 10 * 60,
	checkperiod: 60,
});

/**
 * Runtime lock for currently processing edited messages.
 * @type {Set<string>}
 */
const editLock = new Set();

/**
 * Main class to manage WhatsApp bot connection, socket events, and message dispatch.
 */
class Connect {
	/**
	 * Create a connection manager instance.
	 */
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
	 * Start Baileys connection, initialize plugins, and register socket events.
	 *
	 * @returns {Promise<void>}
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
			}
		}

		const { version } = await fetchLatestBaileysVersion();
		print.info(`Baileys version: ${version.join(".")}`);

		await this.pluginManager.loadPlugins();
		this.pluginManager.watchPlugins();

		this.sock = makeWASocket({
			version,
			browser: Browsers.macOS("Safari"),
			connectTimeoutMs: 60000,
      		keepAliveIntervalMs: 30000,
			logger,
			defaultQueryTimeoutMs: 60000,
      		retryRequestDelayMs: 300,
      		maxMsgRetryCount: 10,
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			markOnlineOnConnect: false,
      		syncFullHistory: false,
      		patchMessageBeforeSending: (msg) => msg,
			shouldHistorySyncMessage: () => false,
      		shouldIgnoreJid: () => false,
      		linkPreviewImageThumbnailWidth: 192,
      		generateHighQualityLinkPreview: true,
      		enableAutoSessionRecreation: true,
      		enableRecentMessageCache: true,
      		appStateMacVerification: {
        		patch: false,
        		snapshot: false,
      		},
			qrTimeout: usePairingCode ? undefined : 60000,
			printQRInTerminal: qrMode,
			msgRetryCounterCache,
			getMessage: async (key) => {
				const jid = safeNorm(key.remoteJid);
				return this.store.loadMessage(jid, key.id)?.message || null;
			},
			getGroupMetadata: async (jid) => {
				const normalizedJid = safeNorm(jid);

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
					metadata = await this.sock.groupMetadata(normalizedJid);
					this.groupMetadataCache.set(normalizedJid, metadata);
					this.store.setGroupMetadata(normalizedJid, metadata);
					return metadata;
				} catch {
					return null;
				}
			},
		});

		this.sock = Client({
			sock: this.sock,
			store: this.store,
		});

		this.pluginManager.scheduleAllPeriodicTasks(this.sock);

		this.sock.ev.on("creds.update", saveCreds);
		this.sock.ev.on("contacts.update", (update) => {
			this.store.updateContacts(update);
		});
		this.sock.ev.on("contacts.upsert", (update) => {
			this.store.upsertContacts(update);
		});
		this.sock.ev.on("chats.upsert", (updates) => {
			this.store.updateChats(updates);
		});
		this.sock.ev.on("chats.update", (updates) => {
			this.store.updateChats(updates);
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
				if (botNumber) {
					setTimeout(async () => {
						try {
							const code = await this.sock.requestPairingCode(
								botNumber.trim()
							);
							print.info(`Your Pairing Code: ${code}`);
							print.info(
								"Enter this code on your WhatsApp phone: Settings -> Linked Devices"
							);
						} catch (e) {
							print.error("Failed to request pairing code:", e);
						}
					}, 6000);
				}
			}

			if (connection === "close") {
				const shouldReconnect =
					lastDisconnect?.error?.output?.statusCode !==
					DisconnectReason.loggedOut;

				print.warn(
					`Connection closed. Reason: ${
						lastDisconnect?.error?.message || "Unknown"
					}. Reconnecting: ${shouldReconnect}`
				);

				if (
					lastDisconnect?.error?.output?.statusCode ===
					DisconnectReason.loggedOut
				) {
					await removeCreds();
					print.info("Session logged out. Credentials removed.");
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

		this.sock.ev.on("messages.upsert", async (data) => {
			const filteredMessages = [];

			for (const msg of data.messages || []) {
				if (!msg?.key?.remoteJid || !msg?.key?.id || !msg?.message) {
					continue;
				}

				const normalizedJid = safeNorm(msg.key.remoteJid);

				if (getEditPayload(msg.message) || data.type === "append") {
					continue;
				}

				const dedupeKey = getUpsertDedupeKey(msg);
				if (processedUpsertCache.get(dedupeKey)) {
					continue;
				}

				processedUpsertCache.set(dedupeKey, true);
				this.store.saveMessage(normalizedJid, msg);
				filteredMessages.push(msg);
			}

			if (filteredMessages.length) {
				return this.message.process(this.sock, {
					...data,
					messages: filteredMessages,
				});
			}
		});

		this.sock.ev.on("messages.update", async (event) => {
			for (const { key, update } of event) {
				if (!key?.remoteJid || !key?.id) {
					continue;
				}

				const normalizedJid = safeNorm(key.remoteJid);

				if (update.pollUpdates) {
					const pollCreation = await this.store.loadMessage(
						normalizedJid,
						key.id
					);
					if (pollCreation?.message) {
						const aggregate = getAggregateVotesInPollMessage({
							message: pollCreation.message,
							pollUpdates: update.pollUpdates,
						});
						print.info("Got poll update, aggregation:", aggregate);
					}
					continue;
				}

				if (!update?.message) {
					continue;
				}

				const editPayload = getEditPayload(update.message);
				if (!editPayload) {
					continue;
				}

				const editedText = getMessageText(editPayload);
				if (!editedText) {
					continue;
				}

				const old = this.store.loadMessage(normalizedJid, key.id);
				const sender = getSenderKey(key, old, normalizedJid);

				const textHash = hashString(editedText.toLowerCase());
				const dedupeKey = `edit:${normalizedJid}:${sender}:${textHash}`;

				if (
					processedEditCache.has(dedupeKey) ||
					editLock.has(dedupeKey)
				) {
					continue;
				}

				processedEditCache.set(dedupeKey, true);
				editLock.add(dedupeKey);

				try {
					const raw = proto.WebMessageInfo.fromObject({
						...(old || {}),
						key,
						message: update.message,
						messageTimestamp:
							update.messageTimestamp ||
							old?.messageTimestamp ||
							Math.floor(Date.now() / 1000),
						pushName: old?.pushName,
						participant: key.participant || old?.participant,
						__meta: {
							...(old?.__meta || {}),
							editText: editedText,
							editTextHash: textHash,
							editDedupeKey: dedupeKey,
						},
					});

					await this.message.process(this.sock, {
						messages: [raw],
						type: "notify",
						isEdit: true,
					});

					this.store.saveMessage(normalizedJid, raw);
				} finally {
					editLock.delete(dedupeKey);
				}
			}
		});

		this.sock.ev.on(
			"group-participants.update",
			async ({ id, participants, action }) => {
				const normalizedGroupJid = safeNorm(id);
				const participantJids = (
					Array.isArray(participants) ? participants : []
				)
					.filter(
						(p) =>
							typeof p === "string" &&
							p &&
							p !== "[object Object]"
					)
					.map(safeNorm);

				print.info(
					`Group participants updated for ${normalizedGroupJid}: ${action} ${participantJids.join(
						", "
					)}`
				);

				try {
					const metadata =
						await this.sock.groupMetadata(normalizedGroupJid);
					if (metadata) {
						this.groupMetadataCache.set(
							normalizedGroupJid,
							metadata
						);
						this.store.setGroupMetadata(
							normalizedGroupJid,
							metadata
						);
					}
				} catch (e) {
					print.error(
						`Failed to refetch metadata for ${normalizedGroupJid}:`,
						e
					);
				}
			}
		);
	}
}

export default Connect;
