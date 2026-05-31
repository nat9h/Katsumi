import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BufferJSON, initAuthCreds } from "baileys";
import Database from "better-sqlite3";
import config from "#config";
import logger from "#libs/utils/logger";

const DATA_DIR = join(process.cwd(), "data");
const AUTH_JSON = join(DATA_DIR, "auth.json");
const KV_JSON = join(DATA_DIR, "kv.json");
const STORE_JSON = join(DATA_DIR, "store.json");

if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Create a debounced function that delays invocation until after `ms`
 * milliseconds have elapsed since the last call.
 *
 * @param {Function} fn - Function to debounce.
 * @param {number} [ms=250] - Debounce delay in milliseconds.
 * @returns {Function & { flush: () => void }} Debounced function with flush method.
 */
function debounce(fn, ms = 250) {
    let t = null;
    const wrapped = () => {
        if (t) {
            clearTimeout(t);
        }
        t = setTimeout(() => {
            t = null;
            fn();
        }, ms);
    };
    wrapped.flush = () => {
        if (t) {
            clearTimeout(t);
            t = null;
            fn();
        }
    };
    return wrapped;
}

/** @type {Set<Function>} Registered flush callbacks for shutdown. */
const _flushers = new Set();

// Ensure all pending writes are flushed on process exit
process.once("beforeExit", () => {
    for (const f of _flushers) {
        try {
            f();
        } catch {}
    }
});
process.once("SIGINT", () => {
    for (const f of _flushers) {
        try {
            f();
        } catch {}
    }
    process.exit(0);
});
process.once("SIGTERM", () => {
    for (const f of _flushers) {
        try {
            f();
        } catch {}
    }
    process.exit(0);
});

/**
 * Create an in-memory signal key store with persistence callback.
 *
 * @param {Function} [persistFn] - Called after each write to trigger persistence.
 * @returns {object} Signal key store with get/set/toJSON/fromJSON methods.
 */
export function createSignalKeyStore(persistFn) {
    const store = new Map();

    return {
        /**
         * Get signal keys by type and IDs.
         * @param {string} type - Key type.
         * @param {string[]} ids - Key IDs to retrieve.
         * @returns {Promise<Record<string, *>>}
         */
        async get(type, ids) {
            const result = {};
            for (const id of ids) {
                const v = store.get(`${type}:${id}`);
                if (v !== undefined) {
                    result[id] = v;
                }
            }
            return result;
        },

        /**
         * Set signal keys (grouped by type).
         * @param {Record<string, Record<string, *>>} data - Keys grouped by type.
         */
        async set(data) {
            for (const [type, keysObj] of Object.entries(data)) {
                if (!keysObj || typeof keysObj !== "object") {
                    continue;
                }
                for (const [id, value] of Object.entries(keysObj)) {
                    const k = `${type}:${id}`;
                    if (value === null || value === undefined) {
                        store.delete(k);
                    } else {
                        store.set(k, value);
                    }
                }
            }
            persistFn?.();
        },

        /** Serialize all keys to a JSON-compatible object. */
        toJSON() {
            const result = {};
            for (const [k, v] of store) {
                const i = k.indexOf(":");
                const type = k.slice(0, i);
                const id = k.slice(i + 1);
                (result[type] ||= {})[id] = v;
            }
            return result;
        },

        /** Hydrate keys from a serialized object. */
        fromJSON(data) {
            store.clear();
            if (!data) {
                return;
            }
            for (const [type, keysObj] of Object.entries(data)) {
                if (!keysObj || typeof keysObj !== "object") {
                    continue;
                }
                for (const [id, v] of Object.entries(keysObj)) {
                    store.set(`${type}:${id}`, v);
                }
            }
        },
    };
}

/**
 * JSON file-based authentication store.
 * Persists credentials and signal keys to auth.json with debounced writes.
 */
class JsonAuthStore {
    constructor() {
        this.creds = initAuthCreds();
        this._write = debounce(() => this._flush(), 100);
        this.keys = createSignalKeyStore(this._write);
        _flushers.add(this._write.flush);
        this._load();
    }

    /** @private */
    _load() {
        try {
            if (!existsSync(AUTH_JSON)) {
                return;
            }
            const data = JSON.parse(
                readFileSync(AUTH_JSON, "utf-8"),
                BufferJSON.reviver,
            );
            if (data.creds) {
                this.creds = data.creds;
            }
            if (data.keys) {
                this.keys.fromJSON(data.keys);
            }
        } catch (err) {
            logger.warn({ err }, "auth.json load failed – fresh start");
        }
    }

    /** Trigger a debounced credentials save. */
    saveCreds() {
        this._write();
    }

    /** @private */
    _flush() {
        try {
            writeFileSync(
                AUTH_JSON,
                JSON.stringify(
                    { creds: this.creds, keys: this.keys.toJSON() },
                    BufferJSON.replacer,
                ),
            );
        } catch (err) {
            logger.error({ err }, "auth.json write failed");
        }
    }
}

/**
 * JSON file-based key-value store.
 * Persists arbitrary key-value pairs to kv.json with debounced writes.
 */
class JsonKeyValueStore {
    constructor() {
        this._data = {};
        this._write = debounce(() => this._flush(), 250);
        _flushers.add(this._write.flush);
        try {
            if (existsSync(KV_JSON)) {
                this._data = JSON.parse(readFileSync(KV_JSON, "utf-8"));
            }
        } catch (err) {
            logger.warn({ err }, "kv.json load failed – fresh start");
        }
    }

    /**
     * Get a value by key.
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        return this._data[key];
    }

    /**
     * Check if a key exists.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return key in this._data;
    }

    /**
     * Set a key-value pair.
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
        this._data[key] = value;
        this._write();
    }

    /**
     * Delete a key.
     * @param {string} key
     */
    delete(key) {
        delete this._data[key];
        this._write();
    }

    /** @private */
    _flush() {
        try {
            writeFileSync(KV_JSON, JSON.stringify(this._data));
        } catch (err) {
            logger.error({ err }, "kv.json write failed");
        }
    }
}

/**
 * JSON file-based data store for contacts, groups, and chats.
 * Persists to store.json with debounced writes.
 */
class JsonDataStore {
    constructor() {
        this.contacts = {};
        this.groups = {};
        this.chats = {};
        this._write = debounce(() => this._flush(), 500);
        _flushers.add(this._write.flush);
        this._load();
    }

    /** @private */
    _load() {
        try {
            if (!existsSync(STORE_JSON)) {
                return;
            }
            const data = JSON.parse(readFileSync(STORE_JSON, "utf-8"));
            this.contacts = data.contacts || {};
            this.groups = data.groups || {};
            this.chats = data.chats || {};
        } catch (err) {
            logger.warn({ err }, "store.json load failed – fresh start");
        }
    }

    upsertContact(c) {
        if (!c?.id || !config.storeContacts) {
            return;
        }
        this.contacts[c.id] = { ...(this.contacts[c.id] || {}), ...c };
        this._write();
    }

    getContact(jid) {
        return this.contacts[jid];
    }

    getAllContacts() {
        return Object.values(this.contacts);
    }

    deleteContact(jid) {
        delete this.contacts[jid];
        this._write();
    }

    upsertGroup(meta) {
        if (!meta?.id || !config.storeGroups) {
            return;
        }
        const existing = this.groups[meta.id] || {};

        if (Array.isArray(meta.participants) && meta.participants.length) {
            this.groups[meta.id] = meta;
        } else {
            const clean = {};
            for (const k in meta) {
                if (meta[k] !== undefined) {
                    clean[k] = meta[k];
                }
            }
            this.groups[meta.id] = { ...existing, ...clean };
        }
        this._write();
    }

    getGroup(jid) {
        return this.groups[jid];
    }

    getAllGroups() {
        return Object.values(this.groups);
    }

    deleteGroup(jid) {
        delete this.groups[jid];
        this._write();
    }

    upsertChat(c) {
        if (!c?.id || !config.storeChats) {
            return;
        }
        this.chats[c.id] = { ...(this.chats[c.id] || {}), ...c };
        this._write();
    }

    getChat(jid) {
        return this.chats[jid];
    }

    getAllChats() {
        return Object.values(this.chats);
    }

    deleteChat(jid) {
        delete this.chats[jid];
        this._write();
    }

    /** @private */
    _flush() {
        try {
            writeFileSync(
                STORE_JSON,
                JSON.stringify({
                    contacts: config.storeContacts ? this.contacts : {},
                    groups: config.storeGroups ? this.groups : {},
                    chats: config.storeChats ? this.chats : {},
                }),
            );
        } catch (err) {
            logger.error({ err }, "store.json write failed");
        }
    }
}

/** @type {import('better-sqlite3').Database|null} */
let _sqliteDb = null;

/**
 * Get or create the SQLite database connection (singleton).
 * Creates tables on first access.
 *
 * @returns {import('better-sqlite3').Database}
 */
function getSqliteDb() {
    if (_sqliteDb) {
        return _sqliteDb;
    }

    const dbPath = config.dbPath || "./bot.db";
    const dir = dirname(dbPath);
    if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    _sqliteDb = new Database(dbPath);
    _sqliteDb.pragma("journal_mode = WAL");
    _sqliteDb.pragma("synchronous = NORMAL");
    _sqliteDb.pragma("temp_store = MEMORY");
    _sqliteDb.pragma("mmap_size = 30000000");
    _sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS auth     (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv       (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contacts (jid TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS groups   (jid TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chats    (jid TEXT PRIMARY KEY, data TEXT NOT NULL);
  `);

    process.once("beforeExit", () => {
        try {
            _sqliteDb.close();
        } catch {}
    });

    return _sqliteDb;
}

/**
 * SQLite-based authentication store.
 * Persists credentials and signal keys to the auth table.
 */
class SqliteAuthStore {
    constructor() {
        this.db = getSqliteDb();
        this.creds = initAuthCreds();
        this._writeKeys = debounce(() => this._persistKeys(), 100);
        this.keys = createSignalKeyStore(this._writeKeys);
        _flushers.add(this._writeKeys.flush);
        this._load();
    }

    /** @private */
    _load() {
        const row = this.db
            .prepare("SELECT key, value FROM auth WHERE key IN (?, ?)")
            .all("creds", "keys");
        for (const r of row) {
            try {
                const parsed = JSON.parse(r.value, BufferJSON.reviver);
                if (r.key === "creds") {
                    this.creds = parsed;
                } else if (r.key === "keys") {
                    this.keys.fromJSON(parsed);
                }
            } catch (err) {
                logger.warn({ err, key: r.key }, "corrupt auth row");
            }
        }
    }

    /** Persist credentials immediately. */
    saveCreds() {
        try {
            this.db
                .prepare(
                    "INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)",
                )
                .run("creds", JSON.stringify(this.creds, BufferJSON.replacer));
        } catch (err) {
            logger.error({ err }, "creds save failed");
        }
    }

    /** @private */
    _persistKeys() {
        try {
            this.db
                .prepare(
                    "INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)",
                )
                .run(
                    "keys",
                    JSON.stringify(this.keys.toJSON(), BufferJSON.replacer),
                );
        } catch (err) {
            logger.error({ err }, "keys save failed");
        }
    }
}

/**
 * SQLite-based key-value store.
 * Uses prepared statements for efficient reads and writes.
 */
class SqliteKeyValueStore {
    constructor() {
        this.db = getSqliteDb();
        this._get = this.db.prepare("SELECT value FROM kv WHERE key = ?");
        this._upsert = this.db.prepare(
            "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
        );
        this._del = this.db.prepare("DELETE FROM kv WHERE key = ?");
        this._has = this.db.prepare("SELECT 1 FROM kv WHERE key = ?");
    }

    /**
     * Get a value by key (auto-parses JSON).
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        const row = this._get.get(key);
        if (!row) {
            return undefined;
        }
        try {
            return JSON.parse(row.value);
        } catch {
            return row.value;
        }
    }

    /**
     * Check if a key exists.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return !!this._has.get(key);
    }

    /**
     * Set a key-value pair (auto-serializes to JSON).
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
        this._upsert.run(key, JSON.stringify(value));
    }

    /**
     * Delete a key.
     * @param {string} key
     */
    delete(key) {
        this._del.run(key);
    }
}

/**
 * SQLite-based data store for contacts, groups, and chats.
 * Uses prepared statements for efficient CRUD operations.
 */
class SqliteDataStore {
    constructor() {
        this.db = getSqliteDb();
        this._stmts = {};
        for (const tbl of ["contacts", "groups", "chats"]) {
            this._stmts[tbl] = {
                get: this.db.prepare(`SELECT data FROM ${tbl} WHERE jid = ?`),
                upsert: this.db.prepare(
                    `INSERT OR REPLACE INTO ${tbl} (jid, data) VALUES (?, ?)`,
                ),
                del: this.db.prepare(`DELETE FROM ${tbl} WHERE jid = ?`),
                all: this.db.prepare(`SELECT data FROM ${tbl}`),
            };
        }
    }

    /** @private */
    _getRow(tbl, jid) {
        const row = this._stmts[tbl].get.get(jid);
        if (!row) {
            return undefined;
        }
        try {
            return JSON.parse(row.data);
        } catch {
            return undefined;
        }
    }

    /** @private */
    _put(tbl, jid, obj) {
        this._stmts[tbl].upsert.run(jid, JSON.stringify(obj));
    }

    /** @private */
    _del(tbl, jid) {
        this._stmts[tbl].del.run(jid);
    }

    /** @private */
    _all(tbl) {
        return this._stmts[tbl].all
            .all()
            .map((r) => {
                try {
                    return JSON.parse(r.data);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    }

    upsertContact(c) {
        if (!c?.id || !config.storeContacts) {
            return;
        }
        this._put("contacts", c.id, {
            ...(this._getRow("contacts", c.id) || {}),
            ...c,
        });
    }

    getContact(jid) {
        return this._getRow("contacts", jid);
    }

    getAllContacts() {
        return this._all("contacts");
    }

    deleteContact(jid) {
        this._del("contacts", jid);
    }

    upsertGroup(meta) {
        if (!meta?.id || !config.storeGroups) {
            return;
        }

        if (Array.isArray(meta.participants) && meta.participants.length) {
            this._put("groups", meta.id, meta);
            return;
        }

        const existing = this._getRow("groups", meta.id) || {};
        const clean = {};
        for (const k in meta) {
            if (meta[k] !== undefined) {
                clean[k] = meta[k];
            }
        }
        this._put("groups", meta.id, { ...existing, ...clean });
    }

    getGroup(jid) {
        return this._getRow("groups", jid);
    }

    getAllGroups() {
        return this._all("groups");
    }

    deleteGroup(jid) {
        this._del("groups", jid);
    }

    upsertChat(c) {
        if (!c?.id || !config.storeChats) {
            return;
        }
        this._put("chats", c.id, {
            ...(this._getRow("chats", c.id) || {}),
            ...c,
        });
    }

    getChat(jid) {
        return this._getRow("chats", jid);
    }

    getAllChats() {
        return this._all("chats");
    }

    deleteChat(jid) {
        this._del("chats", jid);
    }
}

/** @returns {boolean} Whether JSON backend is selected. */
const isJson = () => config.dbType === "json";

/**
 * Create an authentication store (JSON or SQLite based on config).
 * @returns {JsonAuthStore|SqliteAuthStore}
 */
export function createAuthStore() {
    return isJson() ? new JsonAuthStore() : new SqliteAuthStore();
}

/**
 * Create a key-value store (JSON or SQLite based on config).
 * @returns {JsonKeyValueStore|SqliteKeyValueStore}
 */
export function createKeyValueStore() {
    return isJson() ? new JsonKeyValueStore() : new SqliteKeyValueStore();
}

/**
 * Create a data store for contacts/groups/chats (JSON or SQLite based on config).
 * @returns {JsonDataStore|SqliteDataStore}
 */
export function createDataStore() {
    return isJson() ? new JsonDataStore() : new SqliteDataStore();
}
