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
			const id = jidNormalizedUser(contact.id);
			this.contacts[id] = { ...(this.contacts[id] || {}), ...contact };
		}
	}

	/**
	 * Upserts contacts, replacing data and marking as contacts.
	 * @param {Array<Object>} update
	 */
	upsertContacts(update) {
		for (const contact of update) {
			const id = jidNormalizedUser(contact.id);
			this.contacts[id] = { ...contact, isContact: true };
		}
	}

	/**
	 * Updates group metadata for groups that already exist.
	 * @param {Array<Object>} updates
	 */
	updateGroupMetadata(updates) {
		for (const update of updates) {
			const id = update.id;
			if (this.groupMetadata[id]) {
				this.groupMetadata[id] = {
					...this.groupMetadata[id],
					...update,
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
		return this.groupMetadata[jidNormalizedUser(jid)];
	}

	/**
	 * Sets group metadata for a given JID.
	 * @param {string} jid
	 * @param {Object} metadata
	 */
	setGroupMetadata(jid, metadata) {
		this.groupMetadata[jidNormalizedUser(jid)] = metadata;
	}

	/**
	 * Gets contact data by JID.
	 * @param {string} jid
	 * @returns {Object|undefined}
	 */
	getContact(jid) {
		return this.contacts[jidNormalizedUser(jid)];
	}

	/**
	 * Saves a message to the node-cache if it's from the user or is a command.
	 * @param {string} jid
	 * @param {Object} message
	 */
	saveMessage(jid, message) {
		const key = `${jidNormalizedUser(jid)}:${message.key.id}`;
		messageCache.set(key, message);
	}

	/**
	 * Loads a message by JID and message ID from cache.
	 * @param {string} jid
	 * @param {string} id
	 * @returns {Object|null}
	 */
	loadMessage(jid, id) {
		return messageCache.get(`${jidNormalizedUser(jid)}:${id}`) || null;
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
				if (process.env.DEBUG)
					console.warn("Index creation warning:", e?.message);
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

		contacts.forEach((c) => groupMetadataCache.set(c.id, stripMongoId(c)));
		groupMetadata.forEach((g) =>
			groupMetadataCache.set(g.id, stripMongoId(g))
		);
	}

	/**
	 * Saves contacts and group metadata from node-cache to MongoDB.
	 * @returns {Promise<void>}
	 */
	async save() {
		await this._connect();
		const all = allCacheValues(groupMetadataCache);

		const contacts = all.filter((v) => v && v.isContact);
		const groups = all.filter(
			(v) => v && typeof v.id === "string" && v.id.endsWith("@g.us")
		);

		if (contacts.length > 0) {
			const bulkOps = contacts.map((c) => {
				const doc = stripMongoId(c);
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
				const doc = stripMongoId(g);
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
			const id = jidNormalizedUser(contact.id);
			const existing = groupMetadataCache.get(id) || {};
			groupMetadataCache.set(id, {
				...stripMongoId(existing),
				...stripMongoId(contact),
			});
		}
	}

	/**
	 * Upserts contacts, replacing data and marking as contacts.
	 * @param {Array<Object>} update
	 */
	upsertContacts(update) {
		for (const contact of update) {
			const id = jidNormalizedUser(contact.id);
			groupMetadataCache.set(id, {
				...stripMongoId(contact),
				isContact: true,
			});
		}
	}

	/**
	 * Updates group metadata in cache for groups that already exist.
	 * @param {Array<Object>} updates
	 */
	updateGroupMetadata(updates) {
		for (const update of updates) {
			const id = update.id;
			const existing = groupMetadataCache.get(id);
			if (existing) {
				groupMetadataCache.set(id, {
					...stripMongoId(existing),
					...stripMongoId(update),
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
		return groupMetadataCache.get(jidNormalizedUser(jid));
	}

	/**
	 * Sets group metadata for a given JID.
	 * @param {string} jid
	 * @param {Object} metadata
	 */
	setGroupMetadata(jid, metadata) {
		groupMetadataCache.set(jidNormalizedUser(jid), stripMongoId(metadata));
	}

	/**
	 * Gets contact data by JID.
	 * @param {string} jid
	 * @returns {Object|undefined}
	 */
	getContact(jid) {
		return groupMetadataCache.get(jidNormalizedUser(jid));
	}

	/**
	 * Saves a message to the node-cache if it's from the user or is a command.
	 * @param {string} jid
	 * @param {Object} message
	 */
	saveMessage(jid, message) {
		const key = `${jidNormalizedUser(jid)}:${message.key.id}`;
		messageCache.set(key, message);
	}

	/**
	 * Loads a message by JID and message ID from cache.
	 * @param {string} jid
	 * @param {string} id
	 * @returns {Object|null}
	 */
	loadMessage(jid, id) {
		return messageCache.get(`${jidNormalizedUser(jid)}:${id}`) || null;
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
