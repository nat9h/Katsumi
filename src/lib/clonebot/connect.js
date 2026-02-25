import { BOT_CONFIG } from "#config/index";
import Message from "#core/message";
import { useMongoDbAuthState } from "#lib/auth/mongodb";
import { CloneSessionModel } from "#lib/database/models/cloneSessions";
import PluginManager from "#lib/plugins";
import { Client } from "#lib/serialize";
import Store from "#lib/store";
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

export class CloneBot {
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
			logger: pino({ level: "silent" }),
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(
					state.keys,
					pino({ level: "silent" })
				),
			},
			printQRInTerminal: false,
			getMessage: async (key) => {
				const jid = jidNormalizedUser(key.remoteJid);
				return this.store.loadMessage(jid, key.id)?.message || null;
			},
			getGroupMetadata: async (jid) => {
				const gjid = jidNormalizedUser(jid);

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
				const gjid = jidNormalizedUser(id);
				const list = (Array.isArray(participants) ? participants : [])
					.filter(
						(p) =>
							typeof p === "string" &&
							p &&
							p !== "[object Object]"
					)
					.map(jidNormalizedUser);

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
							// ignore
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
					await new Promise((r) => setTimeout(r, 3000));
					let code = await this.sock.requestPairingCode(this.phone);
					code = code?.match(/.{1,4}/g)?.join("-") || code;
					onSuccess?.({ code, sessionName: this.sessionName });
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
				} else {
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
			}
		});
	}
}

export default CloneBot;
