import { BOT_CONFIG } from "#config/index";
import Message from "#core/message";
import { useMongoDbAuthState } from "#lib/auth/mongodb";
import { CloneSessionModel } from "#lib/database/models/cloneSessions";
import PluginManager from "#lib/plugins";
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
import NodeCache from "@cacheable/node-cache";
import {
	Browsers,
	DisconnectReason,
	fetchLatestBaileysVersion,
	getAggregateVotesInPollMessage,
	makeCacheableSignalKeyStore,
	makeWASocket,
	proto,
} from "baileys";
import { randomBytes } from "node:crypto";
import pino from "pino";

const logger = pino({ level: "silent" });

/**
 * Cache used by Baileys to track message retry counters.
 *
 * @type {NodeCache}
 */
const msgRetryCounterCache = new NodeCache();

/**
 * Main class to manage a specific WhatsApp bot clone session.
 */
export class CloneBot {
	/**
	 * Create a CloneBot instance.
	 *
	 * @param {string} phone The phone number for the clone bot.
	 * @param {Object} options Configuration options.
	 */
	constructor(phone, options = {}) {
		this.phone = phone;
		this.sessionId = randomBytes(5).toString("hex");
		this.sessionName =
			options.sessionName || `clone-${phone}-${this.sessionId}`;
		this.mongoUrl = process.env.MONGO_URI;
		this.maxReconnect = options.maxReconnect || 5;
		this.reconnectCount = 0;
		this.sock = null;

		this._gmRefetchTimers = new Map();

		this.groupMetadataCache = new NodeCache({
			stdTTL: 60 * 60,
			checkperiod: 120,
		});

		this.processedUpsertCache = new NodeCache({
			stdTTL: 10 * 60,
			checkperiod: 60,
		});

		this.processedEditCache = new NodeCache({
			stdTTL: 10 * 60,
			checkperiod: 60,
		});

		this.editLock = new Set();

		this.pluginManager = new PluginManager(BOT_CONFIG);
		this.store = new Store(this.sessionName);

		this.messageHandler = new Message(
			this.pluginManager,
			BOT_CONFIG.ownerJids,
			BOT_CONFIG.prefixes,
			this.groupMetadataCache,
			this.store
		);
	}

	/**
	 * Start the CloneBot session.
	 *
	 * @param {Function} onUpdate Callback for connection updates.
	 * @param {Function} onSuccess Callback when connection is successful.
	 * @param {Function} onError Callback when an error occurs.
	 */
	async start(onUpdate, onSuccess, onError) {
		await this.pluginManager.loadPlugins();

		if (!process.env.MONGO_URI || process.env.USE_MONGO === "false") {
			throw new Error(
				"CloneBot requires MongoDB! MONGO_URI is empty or USE_MONGO=false."
			);
		}

		await this.store.load();
		this.store.savePeriodically();

		const { state, saveCreds, removeCreds } = await useMongoDbAuthState(
			this.mongoUrl,
			this.sessionName,
			process.env.MONGO_CLONE_DB,
			process.env.MONGO_CLONE_COLLECTION
		);

		const { version } = await fetchLatestBaileysVersion();

		let sock = makeWASocket({
			version,
			browser: Browsers.macOS("Safari"),
			logger,
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			printQRInTerminal: false,
			syncFullHistory: false,
			generateHighQualityLinkPreview: true,
			msgRetryCounterCache,
			getMessage: async (key) => {
				const jid = safeNorm(key.remoteJid);
				return this.store.loadMessage(jid, key.id)?.message || null;
			},
			getGroupMetadata: async (jid) => {
				const gjid = safeNorm(jid);

				let metadata = this.groupMetadataCache.get(gjid);
				if (metadata) {
					return metadata;
				}

				metadata = this.store.getGroupMetadata(gjid);
				if (metadata) {
					this.groupMetadataCache.set(gjid, metadata);
					return metadata;
				}

				try {
					metadata = await sock.groupMetadata(gjid);

					if (metadata) {
						this.groupMetadataCache.set(gjid, metadata);
						this.store.setGroupMetadata(gjid, metadata);
					}

					return metadata || null;
				} catch {
					return null;
				}
			},
		});

		sock = Client({ sock, store: this.store });
		sock.isClonebot = true;

		this.sock = sock;

		this.pluginManager.scheduleAllPeriodicTasks(this.sock);

		this.sock.ev.on("creds.update", saveCreds);

		this.sock.ev.on("contacts.update", (update) => {
			this.store.updateContacts(update);
		});

		this.sock.ev.on("contacts.upsert", (update) => {
			this.store.upsertContacts(update);
		});

		this.sock.ev.on("chats.upsert", (updates) => {
			this.store.updateChats?.(updates);
		});

		this.sock.ev.on("chats.update", (updates) => {
			this.store.updateChats?.(updates);
		});

		this.sock.ev.on("groups.update", (updates) => {
			this.store.updateGroupMetadata(updates);
		});

		this.sock.ev.on("messages.upsert", async (data) => {
			const filteredMessages = [];

			for (const msg of data.messages || []) {
				if (!msg?.key?.remoteJid || !msg?.key?.id || !msg?.message) {
					continue;
				}

				const normalizedJid = safeNorm(msg.key.remoteJid);
				const editPayload = getEditPayload(msg.message);

				if (editPayload || data.type === "append") {
					continue;
				}

				const dedupeKey = getUpsertDedupeKey(msg);

				if (this.processedUpsertCache.get(dedupeKey)) {
					continue;
				}

				this.processedUpsertCache.set(dedupeKey, true);

				this.store.saveMessage(normalizedJid, msg);
				filteredMessages.push(msg);
			}

			if (!filteredMessages.length) {
				return;
			}

			return this.messageHandler.process(this.sock, {
				...data,
				messages: filteredMessages,
			});
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

						console.log("[CLONE] Got poll update:", aggregate);
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
					this.processedEditCache.has(dedupeKey) ||
					this.editLock.has(dedupeKey)
				) {
					continue;
				}

				this.processedEditCache.set(dedupeKey, true);
				this.editLock.add(dedupeKey);

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

					await this.messageHandler.process(this.sock, {
						messages: [raw],
						type: "notify",
						isEdit: true,
					});

					this.store.saveMessage(normalizedJid, raw);
				} finally {
					this.editLock.delete(dedupeKey);
				}
			}
		});

		this.sock.ev.on(
			"group-participants.update",
			async ({ id, participants, action }) => {
				const gjid = safeNorm(id);

				const list = (Array.isArray(participants) ? participants : [])
					.filter(
						(p) =>
							typeof p === "string" &&
							p &&
							p !== "[object Object]"
					)
					.map(safeNorm);

				if (list.length) {
					console.log(
						`[CLONE] gp.update ${gjid} ${action} ${list.join(", ")}`
					);
				}

				clearTimeout(this._gmRefetchTimers.get(gjid));

				this._gmRefetchTimers.set(
					gjid,
					setTimeout(async () => {
						try {
							const metadata =
								await this.sock.groupMetadata(gjid);

							if (metadata) {
								this.groupMetadataCache.set(gjid, metadata);
								this.store.setGroupMetadata(gjid, metadata);
							}
						} catch {
							console.error(
								`[CLONE] Failed to refetch metadata for ${gjid}:`,
								e?.message || e
							);
						}
					}, 500)
				);
			}
		);

		this.sock.ev.on("connection.update", async (update) => {
			onUpdate?.(update);

			const { connection, lastDisconnect } = update;

			if (!state.creds.registered && connection === "connecting") {
				try {
					await new Promise((resolve) => setTimeout(resolve, 3000));

					let code = await this.sock.requestPairingCode(this.phone);
					code = code?.match(/.{1,4}/g)?.join("-") || code;

					onSuccess?.({
						code,
						sessionName: this.sessionName,
					});
				} catch (e) {
					await removeCreds();
					await CloneSessionModel.remove(this.sessionName);
					this.store.stopSaving();

					onError?.(e);
				}
			}

			if (connection === "open") {
				this.reconnectCount = 0;

				await CloneSessionModel.add(this.sessionName, this.phone);

				onSuccess?.({
					connected: true,
					sessionName: this.sessionName,
				});
			}

			if (connection === "close") {
				const status = lastDisconnect?.error?.output?.statusCode;

				const shouldReconnect =
					status !== DisconnectReason.loggedOut &&
					status !== 401 &&
					this.reconnectCount < this.maxReconnect;

				if (status === DisconnectReason.loggedOut || status === 401) {
					await removeCreds();
					await CloneSessionModel.remove(this.sessionName);
					this.store.stopSaving();

					onError?.(
						new Error(
							"Session expired or logged out. Please re-pair."
						)
					);

					return;
				}

				if (shouldReconnect) {
					this.reconnectCount++;

					setTimeout(
						() => this.start(onUpdate, onSuccess, onError),
						3000
					);

					return;
				}

				await removeCreds();
				await CloneSessionModel.remove(this.sessionName);
				this.store.stopSaving();

				onError?.(
					lastDisconnect?.error ||
						new Error(
							"Connection closed. Please restart clone session."
						)
				);
			}
		});
	}
}

export default CloneBot;
