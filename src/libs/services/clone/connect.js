/**
 * @fileoverview Clone (jadibot) session manager.
 * Lightweight in-process multi-session using SQLite for auth persistence.
 * Each clone shares the same plugins but has its own Baileys socket.
 * Clone users cannot use owner-only commands.
 * @module services/clone
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import makeWASocket, {
    Browsers,
    BufferJSON,
    DisconnectReason,
    fetchLatestBaileysVersion,
    initAuthCreds,
    makeCacheableSignalKeyStore,
} from "baileys";
import Database from "better-sqlite3";
import logger, { print } from "#libs/utils/logger";
import { processMessage } from "#middleware";

const DB_PATH = join(process.cwd(), "data", "clones.db");
const DATA_DIR = join(process.cwd(), "data");

if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS clones (
    jid TEXT PRIMARY KEY,
    owner_jid TEXT NOT NULL,
    creds TEXT NOT NULL,
    keys TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    active INTEGER NOT NULL DEFAULT 1
  );
`);

const stmts = {
    get: db.prepare("SELECT * FROM clones WHERE jid = ?"),
    getByOwner: db.prepare("SELECT * FROM clones WHERE owner_jid = ?"),
    getAll: db.prepare("SELECT * FROM clones WHERE active = 1"),
    upsert: db.prepare(
        "INSERT OR REPLACE INTO clones (jid, owner_jid, creds, keys, created_at, active) VALUES (?, ?, ?, ?, ?, ?)",
    ),
    delete: db.prepare("DELETE FROM clones WHERE jid = ?"),
    deactivate: db.prepare("UPDATE clones SET active = 0 WHERE jid = ?"),
};

/** @type {Map<string, { sock: any, cleanup: () => void }>} */
const sessions = new Map();

/**
 * @param {object} row
 * @returns {{ creds: object, keys: object }}
 */
function parseAuth(row) {
    const creds = JSON.parse(row.creds, BufferJSON.reviver);
    const keys = JSON.parse(row.keys, BufferJSON.reviver);
    return { creds, keys };
}

function saveAuth(jid, ownerJid, creds, keys) {
    stmts.upsert.run(
        jid,
        ownerJid,
        JSON.stringify(creds, BufferJSON.replacer),
        JSON.stringify(keys, BufferJSON.replacer),
        Date.now(),
        1,
    );
}

function createKeyStore(initialKeys) {
    const store = new Map();

    if (initialKeys) {
        for (const [type, obj] of Object.entries(initialKeys)) {
            if (!obj || typeof obj !== "object") {
                continue;
            }
            for (const [id, v] of Object.entries(obj)) {
                store.set(`${type}:${id}`, v);
            }
        }
    }

    return {
        get: async (type, ids) => {
            const result = {};
            for (const id of ids) {
                const v = store.get(`${type}:${id}`);
                if (v !== undefined) {
                    result[id] = v;
                }
            }
            return result;
        },
        set: async (data) => {
            for (const [type, obj] of Object.entries(data)) {
                if (!obj || typeof obj !== "object") {
                    continue;
                }
                for (const [id, value] of Object.entries(obj)) {
                    if (value === null || value === undefined) {
                        store.delete(`${type}:${id}`);
                    } else {
                        store.set(`${type}:${id}`, value);
                    }
                }
            }
        },
        toJSON: () => {
            const result = {};
            for (const [k, v] of store) {
                const i = k.indexOf(":");
                const type = k.slice(0, i);
                const id = k.slice(i + 1);
                (result[type] ||= {})[id] = v;
            }
            return result;
        },
    };
}

/**
 * @param {string} ownerJid
 * @param {import('../../../handlers/Client.js').Client} mainClient
 * @returns {Promise<string>} Pairing code
 */
export async function createClone(ownerJid, mainClient) {
    const existing = stmts.getByOwner.get(ownerJid);
    if (existing && sessions.has(existing.jid)) {
        throw new Error("You already have an active clone.");
    }

    const { version } = await fetchLatestBaileysVersion();
    const creds = initAuthCreds();
    const keys = createKeyStore();

    const sock = makeWASocket({
        version,
        auth: { creds, keys: makeCacheableSignalKeyStore(keys, logger) },
        browser: Browsers.macOS("Safari"),
        printQRInTerminal: false,
        logger,
        markOnlineOnConnect: false,
        syncFullHistory: false,
    });

    const code = await sock.requestPairingCode(ownerJid.split("@")[0]);

    sock.ev.on("creds.update", () => {
        const jid = sock.user?.id;
        if (jid) {
            saveAuth(jid, ownerJid, sock.authState.creds, keys.toJSON());
        }
    });

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            const jid = sock.user.id;
            sessions.set(jid, { sock, cleanup: () => destroySession(jid) });
            saveAuth(jid, ownerJid, sock.authState.creds, keys.toJSON());
            print.ok(`Clone connected: ${jid.split("@")[0]}`);

            mainClient.sendMessage(ownerJid, {
                text: `✅ Clone connected as *${jid.split("@")[0]}*`,
            });
        }

        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            const jid = sock.user?.id;

            if (code === DisconnectReason.loggedOut) {
                if (jid) {
                    sessions.delete(jid);
                    stmts.deactivate.run(jid);
                }
                print.warn(
                    `Clone logged out: ${jid?.split("@")[0] || "unknown"}`,
                );
                return;
            }

            if (jid && sessions.has(jid)) {
                setTimeout(() => reconnectClone(jid, mainClient), 5000);
            }
        }
    });

    sock.ev.on("messages.upsert", ({ type, messages }) => {
        if (type !== "notify") {
            return;
        }
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) {
                continue;
            }
            processMessage(
                {
                    sock,
                    sendMessage: (j, c, o) => sock.sendMessage(j, c, o),
                    db: mainClient.db,
                    store: mainClient.store,
                    groupCache: mainClient.groupCache,
                    ephemeralCache: mainClient.ephemeralCache,
                    stats: mainClient.stats,
                    generateMsgId: () => mainClient.generateMsgId(),
                    _isClone: true,
                    _cloneOwner: ownerJid,
                },
                msg,
            );
        }
    });

    return code;
}

async function reconnectClone(jid, mainClient) {
    const row = stmts.get.get(jid);
    if (!row?.active) {
        return;
    }

    try {
        await startCloneFromRow(row, mainClient);
    } catch (err) {
        print.warn(
            `Clone reconnect failed (${jid.split("@")[0]}): ${err.message}`,
        );
    }
}

async function startCloneFromRow(row, mainClient) {
    const { creds, keys: rawKeys } = parseAuth(row);
    const keys = createKeyStore(rawKeys);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: { creds, keys: makeCacheableSignalKeyStore(keys, logger) },
        browser: Browsers.macOS("Safari"),
        printQRInTerminal: false,
        logger,
        markOnlineOnConnect: false,
        syncFullHistory: false,
    });

    sock.ev.on("creds.update", () => {
        saveAuth(row.jid, row.owner_jid, sock.authState.creds, keys.toJSON());
    });

    sock.ev.on("connection.update", (update) => {
        if (update.connection === "open") {
            sessions.set(row.jid, {
                sock,
                cleanup: () => destroySession(row.jid),
            });
            print.ok(`Clone reconnected: ${row.jid.split("@")[0]}`);
        }
        if (update.connection === "close") {
            const code = update.lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                sessions.delete(row.jid);
                stmts.deactivate.run(row.jid);
                return;
            }
            setTimeout(() => reconnectClone(row.jid, mainClient), 10_000);
        }
    });

    sock.ev.on("messages.upsert", ({ type, messages }) => {
        if (type !== "notify") {
            return;
        }
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) {
                continue;
            }
            processMessage(
                {
                    sock,
                    sendMessage: (j, c, o) => sock.sendMessage(j, c, o),
                    db: mainClient.db,
                    store: mainClient.store,
                    groupCache: mainClient.groupCache,
                    ephemeralCache: mainClient.ephemeralCache,
                    stats: mainClient.stats,
                    generateMsgId: () => mainClient.generateMsgId(),
                    _isClone: true,
                    _cloneOwner: row.owner_jid,
                },
                msg,
            );
        }
    });
}

function destroySession(jid) {
    const session = sessions.get(jid);
    if (session) {
        session.sock.end(undefined);
        sessions.delete(jid);
    }
}

/**
 * @param {string} jid
 */
export function deleteClone(jid) {
    destroySession(jid);
    stmts.delete.run(jid);
}

/**
 * @param {string} ownerJid
 */
export function deleteCloneByOwner(ownerJid) {
    const row = stmts.getByOwner.get(ownerJid);
    if (row) {
        destroySession(row.jid);
        stmts.delete.run(row.jid);
    }
}

/**
 * @returns {object[]}
 */
export function listClones() {
    return stmts.getAll.all().map((r) => ({
        jid: r.jid,
        owner: r.owner_jid,
        created: r.created_at,
    }));
}

/**
 * @param {string} ownerJid
 * @returns {object|null}
 */
export function getCloneByOwner(ownerJid) {
    const row = stmts.getByOwner.get(ownerJid);
    if (!row) {
        return null;
    }
    return {
        jid: row.jid,
        owner: row.owner_jid,
        active: sessions.has(row.jid),
    };
}

/**
 * @param {string} jid
 * @returns {boolean}
 */
export function isCloneSession(jid) {
    return sessions.has(jid);
}

/**
 * @param {import('../../../handlers/Client.js').Client} mainClient
 */
export async function restoreClones(mainClient) {
    const rows = stmts.getAll.all();
    if (!rows.length) {
        return;
    }

    print.info(`Restoring ${rows.length} clone(s)...`);

    for (const row of rows) {
        try {
            await startCloneFromRow(row, mainClient);
        } catch (err) {
            print.warn(
                `Failed to restore clone ${row.jid.split("@")[0]}: ${err.message}`,
            );
        }
    }
}
