import { MONGO_CONFIG } from "#config/index";
import NodeCache from "@cacheable/node-cache";
import { jidNormalizedUser } from "baileys";
import { mkdir, readFile, writeFile } from "fs/promises";
import { MongoClient } from "mongodb";
import { join } from "path";

function allCacheValues(cache) {
	return cache
		.keys()
		.map((k) => cache.get(k))
		.filter((v) => v !== undefined);
}

/** Safely drop Mongo's _id so we never try to $set it */
function stripMongoId(doc) {
	if (!doc || typeof doc !== "object") {
		return doc;
	}
	const { _id, ...rest } = doc;
	return rest;
}

/** @type {NodeCache<string, any>} */
const groupMetadataCache = new NodeCache({
	stdTTL: 60 * 60,
	checkperiod: 120,
});

/** @type {NodeCache<string, any>} */
const messageCache = new NodeCache({
	stdTTL: 30 * 60,
	checkperiod: 120,
});

const norm = (jid) => (jid ? jidNormalizedUser(jid) : jid);
const isLid = (jid) =>
	typeof jid === "string" && /@lid$|@hosted\.lid$/.test(jid);
const isPn = (jid) =>
	typeof jid === "string" && jid.endsWith("@s.whatsapp.net");

function ensureLidIndex(obj) {
	if (!obj.__lidIndex || typeof obj.__lidIndex !== "object") {
		obj.__lidIndex = {};
	}
	return obj.__lidIndex;
}

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
 * Store contacts in a map by:
 * - primary key: contact.id (normalized)
 * - alias key: contact.lid (normalized) -> points to same contact doc
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
 * Represents a local store for session data, backed by JSON files.
 */
class Local {
	/**
	 * @param {string} sessionName - The name of the session, used for file storage paths.
	 */
	constructor(sessionName) {
		/** @type {string} */
		this.sessionName = sessionName;
		this.path = {
			contacts: join(process.cwd(), `${sessionName}/contacts.json`),
			metadata: join(process.cwd(), `${sessionName}/groupMetadata.json`),
			messages: join(process.cwd(), `${sessionName}/messages.json`),
		};
		this.saveInterval = null;
		this.cleanupInterval = null;
		/** @type {Object.<string, any>} */
		this.contacts = {};
		/** @type {Object.<string, any>} */
		this.groupMetadata = {};
		/** @type {Object.<string, any>} */
		this.messages = {};
	}

	/**
	 * Loads contacts and group metadata from JSON files.
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
	 * Helper to read JSON data from file.
	 * @private
	 * @param {string} path
	 * @returns {Promise<Object>}
	 */
	async _loadJson(path) {
		try {
			return JSON.parse(await readFile(path, "utf-8"));
		} catch {
			return {};
		}
	}

	/**
	 * Cleans up old messages (currently a stub).
	 */
	cleanupMessages() {}

	/**
	 * Saves contacts and group metadata to JSON files.
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
	 * Helper to write JSON data to file.
	 * @private
	 * @param {string} path
	 * @param {Object} data
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
	 * Enables periodic saving and message cleanup.
	 * @param {number} [interval=30000] - Interval in ms.
	 */
	savePeriodically(interval = 30000) {
		this.saveInterval && clearInterval(this.saveInterval);
		this.saveInterval = setInterval(() => this.save(), interval);

		this.cleanupInterval && clearInterval(this.cleanupInterval);
		this.cleanupInterval = setInterval(
			() => this.cleanupMessages(),
			600000
		);
	}

	/**
	 * Stops periodic saving and cleanup.
	 */
	stopSaving() {
		this.saveInterval && clearInterval(this.saveInterval);
		this.cleanupInterval && clearInterval(this.cleanupInterval);
		this.saveInterval = null;
		this.cleanupInterval = null;
	}

	/**
	 * Updates existing contacts with partial data.
	 * @param {Array<Object>} update
	 */
	updateContacts(update) {
		for (const contact of update) {
			upsertContactIntoMap(this.contacts, contact, { merge: true });
		}
	}

	/**
	 * Upserts contacts, replacing data and marking as contacts.
	 * @param {Array<Object>} update
	 */
	upsertContacts(update) {
		for (const contact of update) {
			upsertContactIntoMap(this.contacts, contact, {
				merge: true,
				forceIsContact: true,
			});
		}
	}

	/**
	 * Updates group metadata for groups that already exist.
	 * @param {Array<Object>} updates
	 */
	updateGroupMetadata(updates) {
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
	 * Gets group metadata for a given JID.
	 * @param {string} jid
	 * @returns {Object|undefined}
	 */
	getGroupMetadata(jid) {
		return this.groupMetadata[norm(jid)];
	}

	/**
	 * Sets group metadata for a given JID.
	 * @param {string} jid
	 * @param {Object} metadata
	 */
	setGroupMetadata(jid, metadata) {
		const id = norm(jid);
		this.groupMetadata[id] = normalizeGroupMetadata(metadata);
	}

	/**
	 * Gets contact data by JID.
	 * @param {string} jid
	 * @returns {Object|undefined}
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
	 * Saves a message to the node-cache if it's from the user or is a command.
	 * @param {string} jid
	 * @param {Object} message
	 */
	saveMessage(jid, message) {
		const key = `${norm(jid)}:${message.key.id}`;
		messageCache.set(key, message);
	}

	/**
	 * Loads a message by JID and message ID from cache.
	 * @param {string} jid
	 * @param {string} id
	 * @returns {Object|null}
	 */
	loadMessage(jid, id) {
		return messageCache.get(`${norm(jid)}:${id}`) || null;
	}
}

/**
 * Represents a MongoDB-based store for session data.
 */
class Mongo {
	/**
	 * @param {string} sessionName - The name of the session, used as the DB name.
	 */
	constructor(sessionName) {
		/** @type {string} */
		this.sessionName = sessionName;
		this.saveInterval = null;
		this.cleanupInterval = null;
		this.client = null;
		this.db = null;
		this.coll = {};
	}

	/**
	 * Connects to MongoDB and initializes collections.
	 * @private
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
	 * Loads contacts and group metadata into node-cache.
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
	 * Saves contacts and group metadata from node-cache to MongoDB.
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
	 * Cleans up old messages (currently a stub).
	 */
	cleanupMessages() {}

	/**
	 * Enables periodic saving.
	 * @param {number} [interval=30000] - Interval in ms.
	 */
	savePeriodically(interval = 30000) {
		this.saveInterval && clearInterval(this.saveInterval);
		this.saveInterval = setInterval(() => this.save(), interval);
	}

	/**
	 * Stops periodic saving and closes the MongoDB connection after 5 seconds.
	 */
	stopSaving() {
		this.saveInterval && clearInterval(this.saveInterval);
		this.saveInterval = null;
		if (this.client) {
			setTimeout(() => this.client.close(), 5000);
			this.client = null;
		}
	}

	/**
	 * Updates existing contacts in cache with partial data.
	 * @param {Array<Object>} update
	 */
	updateContacts(update) {
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

			// alias in-memory (optional)
			if (lid && isPn(key)) {
				groupMetadataCache.set(lid, groupMetadataCache.get(key));
			}
		}
	}

	/**
	 * Upserts contacts, replacing data and marking as contacts.
	 * @param {Array<Object>} update
	 */
	upsertContacts(update) {
		for (const contact of update) {
			const key = canonicalContactKey(contact);
			if (!key) {
				continue;
			}

			const doc = { ...stripMongoId(contact), id: key, isContact: true };

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
	 * Updates group metadata in cache for groups that already exist.
	 * @param {Array<Object>} updates
	 */
	updateGroupMetadata(updates) {
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
	 * Gets group metadata for a given JID.
	 * @param {string} jid
	 * @returns {Object|undefined}
	 */
	getGroupMetadata(jid) {
		return groupMetadataCache.get(norm(jid));
	}

	/**
	 * Sets group metadata for a given JID.
	 * @param {string} jid
	 * @param {Object} metadata
	 */
	setGroupMetadata(jid, metadata) {
		const id = norm(jid);
		groupMetadataCache.set(
			id,
			stripMongoId(normalizeGroupMetadata(metadata))
		);
	}

	/**
	 * Gets contact data by JID.
	 * @param {string} jid
	 * @returns {Object|undefined}
	 */
	getContact(jid) {
		return groupMetadataCache.get(norm(jid));
	}

	/**
	 * Saves a message to the node-cache if it's from the user or is a command.
	 * @param {string} jid
	 * @param {Object} message
	 */
	saveMessage(jid, message) {
		const key = `${norm(jid)}:${message.key.id}`;
		messageCache.set(key, message);
	}

	/**
	 * Loads a message by JID and message ID from cache.
	 * @param {string} jid
	 * @param {string} id
	 * @returns {Object|null}
	 */
	loadMessage(jid, id) {
		return messageCache.get(`${norm(jid)}:${id}`) || null;
	}
}

/**
 * Versatile session store class. Switches between Mongo and Local backends.
 */
class Store {
	/**
	 * @param {string} sessionName
	 */
	constructor(sessionName) {
		this.backend = MONGO_CONFIG.USE_MONGO
			? new Mongo(sessionName)
			: new Local(sessionName);
	}

	/** @returns {Promise<void>} */
	load() {
		return this.backend.load();
	}

	/** @returns {Promise<void>} */
	save() {
		return this.backend.save();
	}

	/**
	 * @param {number} [interval]
	 */
	savePeriodically(interval) {
		return this.backend.savePeriodically(interval);
	}
	stopSaving() {
		return this.backend.stopSaving();
	}

	/**
	 * @param {Array<Object>} update
	 */
	updateContacts(update) {
		return this.backend.updateContacts(update);
	}

	/**
	 * @param {Array<Object>} update
	 */
	upsertContacts(update) {
		return this.backend.upsertContacts(update);
	}

	/**
	 * @param {Array<Object>} updates
	 */
	updateGroupMetadata(updates) {
		return this.backend.updateGroupMetadata(updates);
	}

	/**
	 * @param {string} jid
	 * @returns {Object|undefined}
	 */
	getGroupMetadata(jid) {
		return this.backend.getGroupMetadata(jid);
	}

	/**
	 * @param {string} jid
	 * @param {Object} metadata
	 */
	setGroupMetadata(jid, metadata) {
		return this.backend.setGroupMetadata(jid, metadata);
	}

	/**
	 * @param {string} jid
	 * @returns {Object|undefined}
	 */
	getContact(jid) {
		return this.backend.getContact(jid);
	}

	/**
	 * @param {string} jid
	 * @param {Object} message
	 */
	saveMessage(jid, message) {
		return this.backend.saveMessage(jid, message);
	}

	/**
	 * @param {string} jid
	 * @param {string} id
	 * @returns {Object|null}
	 */
	loadMessage(jid, id) {
		return this.backend.loadMessage(jid, id);
	}
}

export default Store;
