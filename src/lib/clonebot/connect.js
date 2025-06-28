import NodeCache from "@cacheable/node-cache";
import {
	Browsers,
	DisconnectReason,
	fetchLatestBaileysVersion,
	jidNormalizedUser,
	makeCacheableSignalKeyStore,
	makeWASocket,
} from "baileys";
import { randomBytes } from "node:crypto";
import pino from "pino";
import { BOT_CONFIG } from "../../config/index.js";
import Message from "../../core/message.js";
import { useMongoDbAuthState } from "../auth/mongodb.js";
import { CloneSessionModel } from "../database/models/cloneSessions.js";
import PluginManager from "../plugins.js";
import Store from "../store.js";

export class CloneBot {
	constructor(phone, options = {}) {
		this.phone = phone;
		this.sessionId = randomBytes(5).toString("hex");
		this.sessionName = `clone-${phone}-${this.sessionId}`;
		this.mongoUrl = process.env.MONGO_URI;
		this.maxReconnect = options.maxReconnect || 5;
		this.reconnectCount = 0;
		this.sock = null;
		this.groupMetadataCache = new NodeCache({
			stdTTL: 60 * 60,
			checkperiod: 120,
		});
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

	async start(onUpdate, onSuccess, onError) {
		await this.pluginManager.loadPlugins();
		const { state, saveCreds, removeCreds } = await useMongoDbAuthState(
			this.mongoUrl,
			this.sessionName,
			process.env.MONGO_CLONE_DB,
			process.env.MONGO_CLONE_COLLECTION
		);
		const { version } = await fetchLatestBaileysVersion();

		this.sock = makeWASocket({
			version,
			browser: Browsers.macOS("Safari"),
			logger: pino({ level: "silent" }),
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(
					state.keys,
					pino({ level: "silent" })
				),
			},
			printQRInTerminal: false,
			getMessage: async (key) =>
				this.store.loadMessage(key.remoteJid, key.id)?.message || null,
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
					return metadata;
				} catch {
					return null;
				}
			},
		});

		this.sock.isClonebot = true;
		this.sock.ev.on("creds.update", saveCreds);

		this.sock.ev.on("messages.upsert", (data) =>
			this.messageHandler.process(this.sock, data)
		);
		this.sock.ev.on("groups.update", (updates) => {
			this.store.updateGroupMetadata(updates);
		});
		this.sock.ev.on("contacts.update", (update) => {
			this.store.updateContacts(update);
		});
		this.sock.ev.on("contacts.upsert", (update) => {
			this.store.upsertContacts(update);
		});
		this.sock.ev.on(
			"group-participants.update",
			async ({ id, participants, action }) => {
				const normalizedJid = jidNormalizedUser(id);
				let metadata =
					this.groupMetadataCache.get(normalizedJid) ||
					this.store.getGroupMetadata(normalizedJid);

				if (!metadata) {
					try {
						metadata = await this.sock.groupMetadata(id);
					} catch {
						return;
					}
				}

				const normalizedParticipants =
					participants.map(jidNormalizedUser);
				switch (action) {
					case "add":
						metadata.participants.push(
							...normalizedParticipants.map((id) => ({
								id,
								admin: null,
							}))
						);
						break;
					case "promote":
						metadata.participants.forEach((p) => {
							if (
								normalizedParticipants.includes(
									jidNormalizedUser(p.id)
								)
							) {
								p.admin = "admin";
							}
						});
						break;
					case "demote":
						metadata.participants.forEach((p) => {
							if (
								normalizedParticipants.includes(
									jidNormalizedUser(p.id)
								)
							) {
								p.admin = null;
							}
						});
						break;
					case "remove":
						metadata.participants = metadata.participants.filter(
							(p) =>
								!normalizedParticipants.includes(
									jidNormalizedUser(p.id)
								)
						);
						break;
				}

				this.groupMetadataCache.set(normalizedJid, metadata);
				this.store.setGroupMetadata(normalizedJid, metadata);
			}
		);

		this.sock.ev.on("connection.update", async (update) => {
			onUpdate?.(update);
			const { connection, lastDisconnect } = update;

			if (!state.creds.registered && connection === "connecting") {
				try {
					await new Promise((r) => setTimeout(r, 3000));
					let code = await this.sock.requestPairingCode(this.phone);
					code = code?.match(/.{1,4}/g)?.join("-") || code;
					onSuccess?.({ code, sessionName: this.sessionName });
				} catch (e) {
					await removeCreds();
					await CloneSessionModel.remove(this.sessionName);
					onError?.(e);
				}
			}
			if (connection === "open") {
				this.reconnectCount = 0;
				await CloneSessionModel.add(this.sessionName, this.phone);
				onSuccess?.({ connected: true, sessionName: this.sessionName });
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
					onError?.(
						new Error(
							"Session expired or logged out. Please re-pair."
						)
					);
				} else if (shouldReconnect) {
					this.reconnectCount++;
					setTimeout(() => {
						this.start(onUpdate, onSuccess, onError);
					}, 3000);
				} else {
					await removeCreds();
					await CloneSessionModel.remove(this.sessionName);
					onError?.(
						lastDisconnect?.error ||
							new Error(
								"Connection closed. Please restart the clone session."
							)
					);
				}
			}
		});
	}
}

export default CloneBot;
