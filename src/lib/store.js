import { MONGO_CONFIG } from "#config/index";
import NodeCache from "@cacheable/node-cache";
import {
	extractMessageContent,
	getContentType,
	jidNormalizedUser,
} from "baileys";
import { mkdir, readFile, writeFile } from "fs/promises";
import { MongoClient } from "mongodb";
import { join } from "path";

/**
 * Get all non-undefined values from a NodeCache instance.
 *
 * @param {NodeCache} cache Cache instance.
 * @returns {any[]} Cached values.
 */
function allCacheValues(cache) {
	return cache
		.keys()
		.map((k) => cache.get(k))
		.filter((v) => v !== undefined);
}

/**
 * Remove MongoDB `_id` from a document before using `$set`.
 *
 * @param {any} doc Mongo document.
 * @returns {any} Document without `_id`.
 */
function stripMongoId(doc) {
	if (!doc || typeof doc !== "object") {
		return doc;
	}

	const { _id, ...rest } = doc;
	return rest;
}

/**
 * Shared metadata/contact cache for Mongo backend.
 *
 * @type {NodeCache}
 */
const groupMetadataCache = new NodeCache({
	stdTTL: 60 * 60,
	checkperiod: 120,
});

/**
 * Short-lived message cache used for quote/edit lookup.
 *
 * @type {NodeCache}
 */
const messageCache = new NodeCache({
	stdTTL: 30 * 60,
	checkperiod: 120,
});

/**
 * Short-lived chat cache.
 *
 * Chat data is intentionally not persisted. It is only kept for around 60 seconds
 * to reduce storage usage while still providing ephemeral-expiration fallback.
 *
 * @type {NodeCache}
 */
const chatCache = new NodeCache({
	stdTTL: 60,
	checkperiod: 60,
	deleteOnExpire: true,
});

/**
 * Normalize a WhatsApp JID.
 *
 * @param {string | null | undefined} jid Raw JID.
 * @returns {string | null | undefined} Normalized JID.
 */
const norm = (jid) => (jid ? jidNormalizedUser(jid) : jid);

/**
 * Check if a JID is LID-based.
 *
 * @param {string | null | undefined} jid JID.
 * @returns {boolean} True if LID JID.
 */
const isLid = (jid) =>
	typeof jid === "string" && /@lid$|@hosted\.lid$/.test(jid);

/**
 * Check if a JID is phone-number based.
 *
 * @param {string | null | undefined} jid JID.
 * @returns {boolean} True if phone-number JID.
 */
const isPn = (jid) =>
	typeof jid === "string" && jid.endsWith("@s.whatsapp.net");

/**
 * Deep clone a JSON-like object.
 *
 * @param {any} obj Value to clone.
 * @returns {any} Cloned value.
 */
function cloneDeep(obj) {
	if (!obj || typeof obj !== "object") {
		return obj;
	}

	if (typeof structuredClone === "function") {
		try {
			return structuredClone(obj);
		} catch (error) {
			throw new Error(
				`Failed to clone object: ${error?.message || error}`
			);
		}
	}

	return JSON.parse(JSON.stringify(obj));
}

/**
 * Normalize ephemeral expiration value.
 *
 * @param {any} value Raw value.
 * @returns {number} Expiration in seconds, or 0.
 */
function normalizeExpiration(value) {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Get effective content node from a Baileys message.
 *
 * @param {any} message Raw message.
 * @returns {{ content: any, type: string, node: any }} Content details.
 */
function getMessageNode(message) {
	const content = extractMessageContent(message) || message || {};
	const type = getContentType(content) || Object.keys(content || {})[0] || "";
	const node = type ? content?.[type] : content;

	return { content, type, node };
}

/**
 * Extract ephemeral expiration from a message payload.
 *
 * @param {any} message Raw or nested message.
 * @returns {number} Expiration in seconds.
 */
function extractMessageExpiration(message) {
	if (!message || typeof message !== "object") {
		return 0;
	}

	const candidates = [
		message,
		extractMessageContent(message),
		message?.ephemeralMessage?.message,
		message?.viewOnceMessage?.message,
		message?.viewOnceMessageV2?.message,
		message?.viewOnceMessageV2Extension?.message,
		message?.protocolMessage,
		message?.protocolMessage?.editedMessage,
		message?.editedMessage?.message,
	];

	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object") {
			continue;
		}

		const { content, node } = getMessageNode(candidate);

		const values = [
			node?.contextInfo?.expiration,
			content?.contextInfo?.expiration,
			node?.ephemeralExpiration,
			content?.ephemeralExpiration,
			candidate?.ephemeralExpiration,
			candidate?.protocolMessage?.ephemeralExpiration,
		];

		for (const value of values) {
			const expiration = normalizeExpiration(value);
			if (expiration) {
				return expiration;
			}
		}
	}

	return 0;
}

/**
 * Extract edited message content from a raw message.
 *
 * @param {any} message Raw message.
 * @returns {any | null} Edited message payload.
 */
function getEditedMessage(message) {
	if (!message || typeof message !== "object") {
		return null;
	}

	const content = extractMessageContent(message) || message;

	const protocol =
		content?.protocolMessage ||
		message?.protocolMessage ||
		content?.editedMessage?.message?.protocolMessage ||
		message?.editedMessage?.message?.protocolMessage;

	if (protocol?.editedMessage) {
		return protocol.editedMessage;
	}

	if (content?.editedMessage?.message) {
		return content.editedMessage.message;
	}

	if (message?.editedMessage?.message) {
		return message.editedMessage.message;
	}

	return null;
}

/**
 * Inject contextInfo.expiration into a message payload.
 *
 * @param {any} message Message payload.
 * @param {number} expiration Expiration in seconds.
 * @returns {any} Mutated message payload.
 */
function injectExpiration(message, expiration) {
	const exp = normalizeExpiration(expiration);

	if (!message || typeof message !== "object" || !exp) {
		return message;
	}

	const { node } = getMessageNode(message);

	if (node && typeof node === "object") {
		node.contextInfo = {
			...(node.contextInfo || {}),
			expiration: exp,
		};
	}

	return message;
}

/**
 * Build message object for storage.
 *
 * This preserves old ephemeral expiration metadata when an edited message payload
 * arrives without contextInfo.expiration.
 *
 * @param {any} oldMessage Previous stored message.
 * @param {any} incomingMessage Incoming message/update.
 * @param {number} [fallbackExpiration=0] Chat-level fallback expiration.
 * @returns {any} Message ready to store.
 */
function buildStoredMessage(
	oldMessage,
	incomingMessage,
	fallbackExpiration = 0
) {
	const oldDoc = cloneDeep(oldMessage || null);
	const nextDoc = cloneDeep(incomingMessage || null);

	if (!nextDoc?.key?.id) {
		return nextDoc;
	}

	const oldExpiration =
		normalizeExpiration(oldDoc?.__meta?.expiration) ||
		extractMessageExpiration(oldDoc?.message);

	const incomingExpiration = extractMessageExpiration(nextDoc?.message);

	const finalExpiration =
		incomingExpiration ||
		oldExpiration ||
		normalizeExpiration(fallbackExpiration) ||
		0;

	const editedMessage = getEditedMessage(nextDoc.message);

	if (editedMessage) {
		nextDoc.message = injectExpiration(
			cloneDeep(editedMessage),
			finalExpiration
		);
	} else if (finalExpiration) {
		nextDoc.message = injectExpiration(nextDoc.message, finalExpiration);
	}

	nextDoc.__meta = {
		...(oldDoc?.__meta || {}),
		...(nextDoc.__meta || {}),
		expiration: finalExpiration,
		isEdited: !!editedMessage,
		originalMessage:
			oldDoc?.__meta?.originalMessage ||
			(oldDoc?.message ? cloneDeep(oldDoc.message) : undefined),
		updatedAt: Date.now(),
	};

	return nextDoc;
}

/**
 * Normalize chat object and extract ephemeral expiration.
 *
 * @param {any} chat Chat update object.
 * @returns {any | null} Normalized chat object.
 */
function normalizeChat(chat) {
	if (!chat || typeof chat !== "object") {
		return null;
	}

	const id = norm(chat.id || chat.jid);

	if (!id) {
		return null;
	}

	const expiration =
		normalizeExpiration(chat.ephemeralExpiration) ||
		normalizeExpiration(chat.ephemeral_expiration) ||
		normalizeExpiration(chat.disappearingMode?.duration) ||
		normalizeExpiration(chat.disappearingMode?.ephemeralExpiration) ||
		0;

	return {
		...chat,
		id,
		ephemeralExpiration: expiration,
		__cachedAt: Date.now(),
	};
}

/**
 * Ensure LID index object exists.
 *
 * @param {Record<string, any>} obj Contact map.
 * @returns {Record<string, string>} LID index map.
 */
function ensureLidIndex(obj) {
	if (!obj.__lidIndex || typeof obj.__lidIndex !== "object") {
		obj.__lidIndex = {};
	}

	return obj.__lidIndex;
}

/**
 * Decide canonical contact key.
 *
 * @param {any} contact Contact object.
 * @returns {string | null | undefined} Canonical contact key.
 */
function canonicalContactKey(contact) {
	const id = norm(contact?.id);
	const pn = norm(contact?.phoneNumber);

	if (pn && isPn(pn)) {
		return pn;
	}

	if (id && isPn(id)) {
		return id;
	}

	return id;
}

/**
 * Extract LID JID from contact-like object.
 *
 * @param {any} contact Contact object.
 * @returns {string | null} LID JID.
 */
function extractLid(contact) {
	const lid = norm(contact?.lid);
	const id = norm(contact?.id);

	if (lid && isLid(lid)) {
		return lid;
	}

	if (id && isLid(id)) {
		return id;
	}

	return null;
}

/**
 * Normalize group metadata and participant identities.
 *
 * @param {any} metadata Raw group metadata.
 * @returns {any} Normalized group metadata.
 */
function normalizeGroupMetadata(metadata) {
	if (!metadata || typeof metadata !== "object") {
		return metadata;
	}

	const id = norm(metadata.id);

	const participants = Array.isArray(metadata.participants)
		? metadata.participants.map((p) => ({
				...p,
				id: norm(p?.id || p?.jid),
				phoneNumber: norm(p?.phoneNumber),
				lid: norm(p?.lid),
				jid: norm(p?.jid),
			}))
		: metadata.participants;

	return { ...metadata, id, participants };
}

/**
 * Insert or update a contact in a plain object map.
 *
 * @param {Record<string, any>} mapObj Contact map.
 * @param {any} contact Contact update.
 * @param {{ merge?: boolean, forceIsContact?: boolean }} [options={}] Upsert options.
 * @returns {void}
 */
function upsertContactIntoMap(
	mapObj,
	contact,
	{ merge = false, forceIsContact = false } = {}
) {
	if (!contact || typeof contact !== "object") {
		return;
	}

	const key = canonicalContactKey(contact);

	if (!key) {
		return;
	}

	const existing = mapObj[key] || {};
	const next = merge ? { ...existing, ...contact } : { ...contact };

	next.id = key;
	next.isContact = forceIsContact
		? true
		: existing.isContact || contact.isContact || true;

	const lid = extractLid(contact);
	const pn = norm(contact?.phoneNumber);

	if (isPn(key) && lid) {
		next.lid = lid;
	}

	if (isLid(key) && pn) {
		next.phoneNumber = pn;
	}

	mapObj[key] = next;

	const idx = ensureLidIndex(mapObj);

	if (lid && isPn(key)) {
		idx[lid] = key;
	}

	if (lid && mapObj[lid] && lid !== key) {
		delete mapObj[lid];
	}
}

/**
 * Local JSON-backed store for contacts and group metadata.
 *
 * Messages and chats are kept in memory cache only.
 */
class Local {
	/**
	 * @param {string} sessionName Session folder/database name.
	 */
	constructor(sessionName) {
		this.sessionName = sessionName;

		this.path = {
			contacts: join(process.cwd(), `${sessionName}/contacts.json`),
			metadata: join(process.cwd(), `${sessionName}/groupMetadata.json`),
		};

		this.saveInterval = null;
		this.cleanupInterval = null;
		this.contacts = {};
		this.groupMetadata = {};
		this.messages = {};
	}

	/**
	 * Build message cache key.
	 *
	 * @param {string} jid Chat JID.
	 * @param {string} id Message ID.
	 * @returns {string} Cache key.
	 */
	_messageKey(jid, id) {
		return `${this.sessionName}:${norm(jid)}:${id}`;
	}

	/**
	 * Build chat cache key.
	 *
	 * @param {string} jid Chat JID.
	 * @returns {string} Cache key.
	 */
	_chatKey(jid) {
		return `${this.sessionName}:${norm(jid)}`;
	}

	/**
	 * Load persistent local store.
	 *
	 * @returns {Promise<void>}
	 */
	async load() {
		await mkdir(this.sessionName, { recursive: true });

		this.contacts = (await this._loadJson(this.path.contacts)) || {};
		ensureLidIndex(this.contacts);

		this.groupMetadata = (await this._loadJson(this.path.metadata)) || {};
		this.messages = {};
	}

	/**
	 * Load JSON from file.
	 *
	 * @param {string} path File path.
	 * @returns {Promise<any>} Parsed object or empty object.
	 */
	async _loadJson(path) {
		try {
			return JSON.parse(await readFile(path, "utf-8"));
		} catch {
			return {};
		}
	}

	/**
	 * Save JSON to file.
	 *
	 * @param {string} path File path.
	 * @param {any} data Data to save.
	 * @returns {Promise<void>}
	 */
	async _saveJson(path, data) {
		try {
			await writeFile(path, JSON.stringify(data, null, 2));
		} catch (error) {
			console.error(`Failed to save ${path}:`, error);
		}
	}

	/**
	 * Cleanup old messages.
	 *
	 * Message cleanup is handled by NodeCache TTL.
	 *
	 * @returns {void}
	 */
	cleanupMessages() {}

	/**
	 * Cleanup expired chats.
	 *
	 * Chat cleanup is handled by NodeCache TTL; this method exists as a safety pass.
	 *
	 * @returns {void}
	 */
	cleanupChats() {
		for (const key of chatCache.keys()) {
			if (key.startsWith(`${this.sessionName}:`)) {
				const chat = chatCache.get(key);
				if (!chat) {
					chatCache.del(key);
				}
			}
		}
	}

	/**
	 * Save persistent store to disk.
	 *
	 * @returns {Promise<void>}
	 */
	async save() {
		try {
			await Promise.all([
				this._saveJson(this.path.contacts, this.contacts),
				this._saveJson(this.path.metadata, this.groupMetadata),
			]);
		} catch (error) {
			console.error("Failed to save store:", error);
		}
	}

	/**
	 * Start periodic saving and cleanup.
	 *
	 * @param {number} [interval=30000] Save interval in milliseconds.
	 * @returns {void}
	 */
	savePeriodically(interval = 30000) {
		this.saveInterval && clearInterval(this.saveInterval);
		this.saveInterval = setInterval(() => this.save(), interval);

		this.cleanupInterval && clearInterval(this.cleanupInterval);
		this.cleanupInterval = setInterval(() => {
			this.cleanupMessages();
			this.cleanupChats();
		}, 60 * 1000);
	}

	/**
	 * Stop periodic saving and cleanup.
	 *
	 * @returns {void}
	 */
	stopSaving() {
		this.saveInterval && clearInterval(this.saveInterval);
		this.cleanupInterval && clearInterval(this.cleanupInterval);
		this.saveInterval = null;
		this.cleanupInterval = null;
	}

	/**
	 * Merge contact updates into local contacts.
	 *
	 * @param {Array<any>} [update=[]] Contact updates.
	 * @returns {void}
	 */
	updateContacts(update = []) {
		for (const contact of update) {
			upsertContactIntoMap(this.contacts, contact, { merge: true });
		}
	}

	/**
	 * Upsert contacts into local contacts.
	 *
	 * @param {Array<any>} [update=[]] Contact updates.
	 * @returns {void}
	 */
	upsertContacts(update = []) {
		for (const contact of update) {
			upsertContactIntoMap(this.contacts, contact, {
				merge: true,
				forceIsContact: true,
			});
		}
	}

	/**
	 * Update short-lived chat cache.
	 *
	 * @param {Array<any>} [updates=[]] Chat updates.
	 * @returns {void}
	 */
	updateChats(updates = []) {
		for (const update of updates) {
			const chat = normalizeChat(update);

			if (!chat) {
				continue;
			}

			const key = this._chatKey(chat.id);
			const old = chatCache.get(key) || {};

			chatCache.set(
				key,
				{
					...old,
					...chat,
					ephemeralExpiration:
						chat.ephemeralExpiration ||
						old.ephemeralExpiration ||
						0,
				},
				60
			);
		}
	}

	/**
	 * Get cached chat.
	 *
	 * @param {string} jid Chat JID.
	 * @returns {any | null} Cached chat or null.
	 */
	getChat(jid) {
		return chatCache.get(this._chatKey(jid)) || null;
	}

	/**
	 * Set cached chat manually.
	 *
	 * @param {string} jid Chat JID.
	 * @param {any} chat Chat data.
	 * @returns {void}
	 */
	setChat(jid, chat) {
		const normalized = normalizeChat({
			...(chat || {}),
			id: jid,
		});

		if (!normalized) {
			return;
		}

		const key = this._chatKey(normalized.id);
		const old = chatCache.get(key) || {};

		chatCache.set(
			key,
			{
				...old,
				...normalized,
				ephemeralExpiration:
					normalized.ephemeralExpiration ||
					old.ephemeralExpiration ||
					0,
			},
			60
		);
	}

	/**
	 * Merge group metadata updates.
	 *
	 * @param {Array<any>} [updates=[]] Group updates.
	 * @returns {void}
	 */
	updateGroupMetadata(updates = []) {
		for (const update of updates) {
			const id = norm(update.id);

			if (id && this.groupMetadata[id]) {
				this.groupMetadata[id] = {
					...this.groupMetadata[id],
					...update,
					id,
				};
			}
		}
	}

	/**
	 * Get group metadata.
	 *
	 * @param {string} jid Group JID.
	 * @returns {any | undefined} Group metadata.
	 */
	getGroupMetadata(jid) {
		return this.groupMetadata[norm(jid)];
	}

	/**
	 * Set group metadata.
	 *
	 * @param {string} jid Group JID.
	 * @param {any} metadata Group metadata.
	 * @returns {void}
	 */
	setGroupMetadata(jid, metadata) {
		const id = norm(jid);
		this.groupMetadata[id] = normalizeGroupMetadata(metadata);
	}

	/**
	 * Get contact by JID.
	 *
	 * @param {string} jid Contact JID.
	 * @returns {any | undefined} Contact data.
	 */
	getContact(jid) {
		const key = norm(jid);

		if (!key) {
			return undefined;
		}

		if (isLid(key)) {
			const idx = ensureLidIndex(this.contacts);
			const pnKey = idx[key];

			if (pnKey && this.contacts[pnKey]) {
				return this.contacts[pnKey];
			}
		}

		return this.contacts[key];
	}

	/**
	 * Save message to memory cache.
	 *
	 * @param {string} jid Chat JID.
	 * @param {any} message Baileys WebMessageInfo.
	 * @returns {void}
	 */
	saveMessage(jid, message) {
		if (!message?.key?.id) {
			return;
		}

		const chatJid = norm(jid || message.key.remoteJid);
		const key = this._messageKey(chatJid, message.key.id);
		const old = messageCache.get(key) || null;
		const chat = this.getChat(chatJid);
		const fallbackExpiration = chat?.ephemeralExpiration || 0;

		const next = buildStoredMessage(old, message, fallbackExpiration);
		messageCache.set(key, cloneDeep(next));
	}

	/**
	 * Load message from memory cache.
	 *
	 * @param {string} jid Chat JID.
	 * @param {string} id Message ID.
	 * @returns {any | null} Stored message or null.
	 */
	loadMessage(jid, id) {
		const data = messageCache.get(this._messageKey(jid, id));
		return data ? cloneDeep(data) : null;
	}
}

/**
 * Mongo-backed store for contacts and group metadata.
 *
 * Messages and chats are kept in memory cache only.
 */
class Mongo {
	/**
	 * @param {string} sessionName Mongo database/session name.
	 */
	constructor(sessionName) {
		this.sessionName = sessionName;
		this.saveInterval = null;
		this.cleanupInterval = null;
		this.client = null;
		this.db = null;
		this.coll = {};
	}

	/**
	 * Build message cache key.
	 *
	 * @param {string} jid Chat JID.
	 * @param {string} id Message ID.
	 * @returns {string} Cache key.
	 */
	_messageKey(jid, id) {
		return `${this.sessionName}:${norm(jid)}:${id}`;
	}

	/**
	 * Build chat cache key.
	 *
	 * @param {string} jid Chat JID.
	 * @returns {string} Cache key.
	 */
	_chatKey(jid) {
		return `${this.sessionName}:${norm(jid)}`;
	}

	/**
	 * Connect to MongoDB and initialize collections/indexes.
	 *
	 * @returns {Promise<void>}
	 */
	async _connect() {
		if (!this.client) {
			this.client = new MongoClient(MONGO_CONFIG.uri);
			await this.client.connect();

			this.db = this.client.db(this.sessionName);
			this.coll.contacts = this.db.collection("contacts");
			this.coll.groupMetadata = this.db.collection("groupMetadata");

			try {
				await Promise.all([
					this.coll.contacts.createIndex({ id: 1 }, { unique: true }),
					this.coll.groupMetadata.createIndex(
						{ id: 1 },
						{ unique: true }
					),
				]);
			} catch (e) {
				if (process.env.DEBUG) {
					console.warn("Index creation warning:", e?.message);
				}
			}
		}
	}

	/**
	 * Load persistent Mongo store into memory cache.
	 *
	 * @returns {Promise<void>}
	 */
	async load() {
		await this._connect();

		const [contacts, groupMetadata] = await Promise.all([
			this.coll.contacts.find().toArray(),
			this.coll.groupMetadata.find().toArray(),
		]);

		contacts.forEach((c) => {
			const doc = stripMongoId(c);
			const id = norm(doc.id);

			if (!id) {
				return;
			}

			groupMetadataCache.set(id, { ...doc, id, isContact: true });

			const lid = norm(doc.lid);

			if (lid && isLid(lid)) {
				groupMetadataCache.set(lid, groupMetadataCache.get(id));
			}
		});

		groupMetadata.forEach((g) => {
			const doc = normalizeGroupMetadata(stripMongoId(g));

			if (doc?.id) {
				groupMetadataCache.set(doc.id, doc);
			}
		});
	}

	/**
	 * Cleanup old messages.
	 *
	 * Message cleanup is handled by NodeCache TTL.
	 *
	 * @returns {void}
	 */
	cleanupMessages() {}

	/**
	 * Cleanup expired chats.
	 *
	 * Chat cleanup is handled by NodeCache TTL; this method exists as a safety pass.
	 *
	 * @returns {void}
	 */
	cleanupChats() {
		for (const key of chatCache.keys()) {
			if (key.startsWith(`${this.sessionName}:`)) {
				const chat = chatCache.get(key);
				if (!chat) {
					chatCache.del(key);
				}
			}
		}
	}

	/**
	 * Save cached contacts and group metadata to MongoDB.
	 *
	 * @returns {Promise<void>}
	 */
	async save() {
		await this._connect();

		const all = allCacheValues(groupMetadataCache);

		const rawContacts = all.filter((v) => v && v.isContact);
		const byId = new Map();

		for (const c of rawContacts) {
			let id = norm(c.id);
			const pn = norm(c.phoneNumber);

			if (id && isLid(id) && pn && isPn(pn)) {
				id = pn;
			}

			if (!id) {
				continue;
			}

			if (!byId.has(id)) {
				byId.set(id, c);
			}
		}

		const contacts = Array.from(byId.values());

		const groups = all.filter(
			(v) => v && typeof v.id === "string" && v.id.endsWith("@g.us")
		);

		if (contacts.length > 0) {
			const bulkOps = contacts.map((c) => {
				const doc = stripMongoId(c);
				doc.id = norm(doc.id);
				doc.phoneNumber = norm(doc.phoneNumber);
				doc.lid = norm(doc.lid);

				if (
					doc.id &&
					isLid(doc.id) &&
					doc.phoneNumber &&
					isPn(doc.phoneNumber)
				) {
					doc.lid = doc.lid || doc.id;
					doc.id = doc.phoneNumber;
				}

				return {
					updateOne: {
						filter: { id: doc.id },
						update: { $set: doc },
						upsert: true,
					},
				};
			});

			await this.coll.contacts.bulkWrite(bulkOps);
		}

		if (groups.length > 0) {
			const bulkOps = groups.map((g) => {
				const doc = stripMongoId(normalizeGroupMetadata(g));
				doc.id = norm(doc.id);

				return {
					updateOne: {
						filter: { id: doc.id },
						update: { $set: doc },
						upsert: true,
					},
				};
			});

			await this.coll.groupMetadata.bulkWrite(bulkOps);
		}
	}

	/**
	 * Start periodic saving and cleanup.
	 *
	 * @param {number} [interval=30000] Save interval in milliseconds.
	 * @returns {void}
	 */
	savePeriodically(interval = 30000) {
		this.saveInterval && clearInterval(this.saveInterval);
		this.saveInterval = setInterval(() => this.save(), interval);

		this.cleanupInterval && clearInterval(this.cleanupInterval);
		this.cleanupInterval = setInterval(() => {
			this.cleanupMessages();
			this.cleanupChats();
		}, 60 * 1000);
	}

	/**
	 * Stop periodic saving, cleanup, and close Mongo connection.
	 *
	 * @returns {void}
	 */
	stopSaving() {
		this.saveInterval && clearInterval(this.saveInterval);
		this.cleanupInterval && clearInterval(this.cleanupInterval);

		this.saveInterval = null;
		this.cleanupInterval = null;

		if (this.client) {
			setTimeout(() => this.client.close(), 5000);
			this.client = null;
		}
	}

	/**
	 * Merge contact updates into memory cache.
	 *
	 * @param {Array<any>} [update=[]] Contact updates.
	 * @returns {void}
	 */
	updateContacts(update = []) {
		for (const contact of update) {
			const key = canonicalContactKey(contact);

			if (!key) {
				continue;
			}

			const existing = groupMetadataCache.get(key) || {};

			const merged = {
				...stripMongoId(existing),
				...stripMongoId(contact),
				id: key,
				isContact: existing.isContact || contact.isContact || true,
			};

			const lid = extractLid(contact);

			if (lid && isPn(key)) {
				merged.lid = lid;
			}

			groupMetadataCache.set(key, merged);

			if (lid && isPn(key)) {
				groupMetadataCache.set(lid, groupMetadataCache.get(key));
			}
		}
	}

	/**
	 * Upsert contacts into memory cache.
	 *
	 * @param {Array<any>} [update=[]] Contact updates.
	 * @returns {void}
	 */
	upsertContacts(update = []) {
		for (const contact of update) {
			const key = canonicalContactKey(contact);

			if (!key) {
				continue;
			}

			const doc = {
				...stripMongoId(contact),
				id: key,
				isContact: true,
			};

			const lid = extractLid(contact);

			if (lid && isPn(key)) {
				doc.lid = lid;
			}

			groupMetadataCache.set(key, doc);

			if (lid && isPn(key)) {
				groupMetadataCache.set(lid, groupMetadataCache.get(key));
			}
		}
	}

	/**
	 * Update short-lived chat cache.
	 *
	 * @param {Array<any>} [updates=[]] Chat updates.
	 * @returns {void}
	 */
	updateChats(updates = []) {
		for (const update of updates) {
			const chat = normalizeChat(update);

			if (!chat) {
				continue;
			}

			const key = this._chatKey(chat.id);
			const old = chatCache.get(key) || {};

			chatCache.set(
				key,
				{
					...stripMongoId(old),
					...stripMongoId(chat),
					ephemeralExpiration:
						chat.ephemeralExpiration ||
						old.ephemeralExpiration ||
						0,
				},
				60
			);
		}
	}

	/**
	 * Get cached chat.
	 *
	 * @param {string} jid Chat JID.
	 * @returns {any | null} Cached chat or null.
	 */
	getChat(jid) {
		return chatCache.get(this._chatKey(jid)) || null;
	}

	/**
	 * Set cached chat manually.
	 *
	 * @param {string} jid Chat JID.
	 * @param {any} chat Chat data.
	 * @returns {void}
	 */
	setChat(jid, chat) {
		const normalized = normalizeChat({
			...(chat || {}),
			id: jid,
		});

		if (!normalized) {
			return;
		}

		const key = this._chatKey(normalized.id);
		const old = chatCache.get(key) || {};

		chatCache.set(
			key,
			{
				...stripMongoId(old),
				...stripMongoId(normalized),
				ephemeralExpiration:
					normalized.ephemeralExpiration ||
					old.ephemeralExpiration ||
					0,
			},
			60
		);
	}

	/**
	 * Merge group metadata updates.
	 *
	 * @param {Array<any>} [updates=[]] Group updates.
	 * @returns {void}
	 */
	updateGroupMetadata(updates = []) {
		for (const update of updates) {
			const id = norm(update.id);
			const existing = id ? groupMetadataCache.get(id) : null;

			if (existing && id) {
				groupMetadataCache.set(id, {
					...stripMongoId(existing),
					...stripMongoId(update),
					id,
				});
			}
		}
	}

	/**
	 * Get group metadata.
	 *
	 * @param {string} jid Group JID.
	 * @returns {any | undefined} Group metadata.
	 */
	getGroupMetadata(jid) {
		return groupMetadataCache.get(norm(jid));
	}

	/**
	 * Set group metadata.
	 *
	 * @param {string} jid Group JID.
	 * @param {any} metadata Group metadata.
	 * @returns {void}
	 */
	setGroupMetadata(jid, metadata) {
		const id = norm(jid);

		groupMetadataCache.set(
			id,
			stripMongoId(normalizeGroupMetadata(metadata))
		);
	}

	/**
	 * Get contact by JID.
	 *
	 * @param {string} jid Contact JID.
	 * @returns {any | undefined} Contact data.
	 */
	getContact(jid) {
		return groupMetadataCache.get(norm(jid));
	}

	/**
	 * Save message to memory cache.
	 *
	 * @param {string} jid Chat JID.
	 * @param {any} message Baileys WebMessageInfo.
	 * @returns {void}
	 */
	saveMessage(jid, message) {
		if (!message?.key?.id) {
			return;
		}

		const chatJid = norm(jid || message.key.remoteJid);
		const key = this._messageKey(chatJid, message.key.id);
		const old = messageCache.get(key) || null;
		const chat = this.getChat(chatJid);
		const fallbackExpiration = chat?.ephemeralExpiration || 0;

		const next = buildStoredMessage(old, message, fallbackExpiration);
		messageCache.set(key, cloneDeep(next));
	}

	/**
	 * Load message from memory cache.
	 *
	 * @param {string} jid Chat JID.
	 * @param {string} id Message ID.
	 * @returns {any | null} Stored message or null.
	 */
	loadMessage(jid, id) {
		const data = messageCache.get(this._messageKey(jid, id));
		return data ? cloneDeep(data) : null;
	}
}

/**
 * Store facade that switches between Local and Mongo backends.
 */
class Store {
	/**
	 * @param {string} sessionName Session/database name.
	 */
	constructor(sessionName) {
		this.backend = MONGO_CONFIG.USE_MONGO
			? new Mongo(sessionName)
			: new Local(sessionName);
	}

	/**
	 * Load backend store.
	 *
	 * @returns {Promise<void>}
	 */
	load() {
		return this.backend.load();
	}

	/**
	 * Save backend store.
	 *
	 * @returns {Promise<void>}
	 */
	save() {
		return this.backend.save();
	}

	/**
	 * Start periodic saving.
	 *
	 * @param {number} [interval] Save interval in milliseconds.
	 * @returns {void}
	 */
	savePeriodically(interval) {
		return this.backend.savePeriodically(interval);
	}

	/**
	 * Stop periodic saving.
	 *
	 * @returns {void}
	 */
	stopSaving() {
		return this.backend.stopSaving();
	}

	/**
	 * Update contacts.
	 *
	 * @param {Array<any>} update Contact updates.
	 * @returns {void}
	 */
	updateContacts(update) {
		return this.backend.updateContacts(update);
	}

	/**
	 * Upsert contacts.
	 *
	 * @param {Array<any>} update Contact updates.
	 * @returns {void}
	 */
	upsertContacts(update) {
		return this.backend.upsertContacts(update);
	}

	/**
	 * Update short-lived chat cache.
	 *
	 * @param {Array<any>} updates Chat updates.
	 * @returns {void}
	 */
	updateChats(updates) {
		return this.backend.updateChats(updates);
	}

	/**
	 * Get cached chat.
	 *
	 * @param {string} jid Chat JID.
	 * @returns {any | null} Cached chat.
	 */
	getChat(jid) {
		return this.backend.getChat(jid);
	}

	/**
	 * Set cached chat.
	 *
	 * @param {string} jid Chat JID.
	 * @param {any} chat Chat data.
	 * @returns {void}
	 */
	setChat(jid, chat) {
		return this.backend.setChat(jid, chat);
	}

	/**
	 * Update group metadata.
	 *
	 * @param {Array<any>} updates Group updates.
	 * @returns {void}
	 */
	updateGroupMetadata(updates) {
		return this.backend.updateGroupMetadata(updates);
	}

	/**
	 * Get group metadata.
	 *
	 * @param {string} jid Group JID.
	 * @returns {any | undefined} Group metadata.
	 */
	getGroupMetadata(jid) {
		return this.backend.getGroupMetadata(jid);
	}

	/**
	 * Set group metadata.
	 *
	 * @param {string} jid Group JID.
	 * @param {any} metadata Group metadata.
	 * @returns {void}
	 */
	setGroupMetadata(jid, metadata) {
		return this.backend.setGroupMetadata(jid, metadata);
	}

	/**
	 * Get contact.
	 *
	 * @param {string} jid Contact JID.
	 * @returns {any | undefined} Contact data.
	 */
	getContact(jid) {
		return this.backend.getContact(jid);
	}

	/**
	 * Save message.
	 *
	 * @param {string} jid Chat JID.
	 * @param {any} message Baileys WebMessageInfo.
	 * @returns {void}
	 */
	saveMessage(jid, message) {
		return this.backend.saveMessage(jid, message);
	}

	/**
	 * Load message.
	 *
	 * @param {string} jid Chat JID.
	 * @param {string} id Message ID.
	 * @returns {any | null} Stored message.
	 */
	loadMessage(jid, id) {
		return this.backend.loadMessage(jid, id);
	}
}

export default Store;
