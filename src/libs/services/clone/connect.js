/**
 * @fileoverview Clone (jadibot) session manager.
 * Lightweight in-process multi-session using SQLite or JSON for auth
 * persistence (selected via DB_TYPE env, same as the main bot).
 * Each clone shares the same plugins but has its own Baileys socket.
 * Clone users cannot use owner-only commands.
 * @module services/clone
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import pino from "pino";
import config from "#config";
import { print } from "#libs/utils/logger";
import { processMessage } from "#middleware";

const cloneLogger = pino({
    level: process.env.CLONE_LOG_LEVEL || "warn",
});

const DATA_DIR = join(process.cwd(), "data");
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * @typedef {object} CloneRow
 * @property {string} jid
 * @property {string} owner_jid
 * @property {string} creds   JSON string
 * @property {string} keys    JSON string
 * @property {number} created_at
 * @property {number} active  0 or 1
 */

/**
 * @typedef {object} CloneStore
 * @property {(jid: string) => CloneRow | undefined} get
 * @property {(ownerJid: string) => CloneRow | undefined} getByOwner
 * @property {() => CloneRow[]} getAllActive
 * @property {(row: CloneRow) => void} upsert
 * @property {(jid: string) => void} delete
 * @property {(jid: string) => void} deactivate
 */

/**
 * SQLite-backed clone store.
 * @returns {CloneStore}
 */
function createSqliteStore() {
    const dbPath = join(DATA_DIR, "clones.db");
    const db = new Database(dbPath);
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

    return {
        get: (jid) => stmts.get.get(jid),
        getByOwner: (ownerJid) => stmts.getByOwner.get(ownerJid),
        getAllActive: () => stmts.getAll.all(),
        upsert: (row) =>
            stmts.upsert.run(
                row.jid,
                row.owner_jid,
                row.creds,
                row.keys,
                row.created_at,
                row.active,
            ),
        delete: (jid) => stmts.delete.run(jid),
        deactivate: (jid) => stmts.deactivate.run(jid),
    };
}

/**
 * JSON-file-backed clone store. Same interface as the SQLite one.
 * @returns {CloneStore}
 */
function createJsonStore() {
    const filePath = join(DATA_DIR, "clones.json");
    /** @type {Record<string, CloneRow>} */
    let data = {};

    if (existsSync(filePath)) {
        try {
            data = JSON.parse(readFileSync(filePath, "utf-8")) || {};
        } catch (err) {
            print.warn(`clones.json corrupt, starting fresh: ${err.message}`);
            data = {};
        }
    }

    let writeTimer = null;
    const flush = () => {
        try {
            writeFileSync(filePath, JSON.stringify(data));
        } catch (err) {
            print.error(`clones.json write failed: ${err.message}`);
        }
    };
    const scheduleWrite = () => {
        if (writeTimer) {
            clearTimeout(writeTimer);
        }
        writeTimer = setTimeout(() => {
            writeTimer = null;
            flush();
        }, 100);
    };
    process.once("beforeExit", () => {
        if (writeTimer) {
            clearTimeout(writeTimer);
            flush();
        }
    });

    return {
        get: (jid) => data[jid],
        getByOwner: (ownerJid) =>
            Object.values(data).find((r) => r.owner_jid === ownerJid),
        getAllActive: () => Object.values(data).filter((r) => r.active === 1),
        upsert: (row) => {
            data[row.jid] = row;
            scheduleWrite();
        },
        delete: (jid) => {
            delete data[jid];
            scheduleWrite();
        },
        deactivate: (jid) => {
            if (data[jid]) {
                data[jid].active = 0;
                scheduleWrite();
            }
        },
    };
}

/** @type {CloneStore} */
const store =
    config.cloneDbType === "json" ? createJsonStore() : createSqliteStore();

/** @type {Map<string, { sock: any, cleanup: () => void }>} */
const sessions = new Map();

/** JIDs that were intentionally stopped — skip reconnect on close. */
const stoppedJids = new Set();

/**
 * @param {CloneRow} row
 * @returns {{ creds: object, keys: object }}
 */
function parseAuth(row) {
    const creds = JSON.parse(row.creds, BufferJSON.reviver);
    const keys = JSON.parse(row.keys, BufferJSON.reviver);
    return { creds, keys };
}

function saveAuth(jid, ownerJid, creds, keys) {
    store.upsert({
        jid,
        owner_jid: ownerJid,
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: JSON.stringify(keys, BufferJSON.replacer),
        created_at: Date.now(),
        active: 1,
    });
}

/**
 * Create a Signal key store with a persist callback.
 * @param {object} [initialKeys]
 * @param {Function} [onChange]
 */
function createKeyStore(initialKeys, onChange) {
    const map = new Map();

    if (initialKeys) {
        for (const [type, obj] of Object.entries(initialKeys)) {
            if (!obj || typeof obj !== "object") {
                continue;
            }
            for (const [id, v] of Object.entries(obj)) {
                map.set(`${type}:${id}`, v);
            }
        }
    }

    return {
        get: async (type, ids) => {
            const result = {};
            for (const id of ids) {
                const v = map.get(`${type}:${id}`);
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
                        map.delete(`${type}:${id}`);
                    } else {
                        map.set(`${type}:${id}`, value);
                    }
                }
            }
            onChange?.();
        },
        toJSON: () => {
            const result = {};
            for (const [k, v] of map) {
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
 * Register a clone socket: bind events, plug into the main client's services.
 *
 * @param {object} ctx
 * @param {string} ctx.ownerJid Owner's WhatsApp JID.
 * @param {object} ctx.creds Auth creds (mutated in-place by Baileys).
 * @param {object} ctx.keys Signal key store.
 * @param {object} ctx.sock Baileys socket.
 * @param {import('../../../handlers/Client.js').Client} ctx.mainClient
 * @param {string} [ctx.knownJid] If reconnecting, the previously assigned JID.
 * @param {Function} ctx.restart Recreates the socket with the same creds/keys.
 */
function bindCloneEvents({
    ownerJid,
    creds,
    keys,
    sock,
    mainClient,
    knownJid,
    restart,
}) {
    const phoneTag = `[clone:${ownerJid.split("@")[0]}]`;

    const persist = () => {
        const jid = sock.user?.id || knownJid;
        if (jid) {
            saveAuth(jid, ownerJid, creds, keys.toJSON());
        }
    };

    sock.ev.on("creds.update", persist);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            const jid = sock.user.id;
            sessions.set(jid, { sock, cleanup: () => destroySession(jid) });
            saveAuth(jid, ownerJid, creds, keys.toJSON());
            print.ok(`Clone connected: ${jid.split("@")[0]}`);

            // Notify owner only on the first connect (not reconnects)
            if (!knownJid) {
                mainClient
                    .sendMessage(ownerJid, {
                        text: `✅ Clone connected as *${jid.split("@")[0]}*`,
                    })
                    .catch((err) =>
                        print.warn(
                            `${phoneTag} failed to notify owner: ${err.message}`,
                        ),
                    );
            }
        }

        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const jid = sock.user?.id || knownJid;

            // Intentionally stopped → don't reconnect
            if (jid && stoppedJids.has(jid)) {
                stoppedJids.delete(jid);
                sessions.delete(jid);
                print.info(`${phoneTag} stopped`);
                return;
            }

            if (
                statusCode === DisconnectReason.loggedOut ||
                statusCode === 401
            ) {
                if (jid) {
                    sessions.delete(jid);
                    store.deactivate(jid);
                }
                print.warn(
                    `Clone logged out: ${jid?.split("@")[0] || "unknown"}`,
                );
                return;
            }

            if (statusCode === DisconnectReason.restartRequired) {
                if (jid) {
                    sessions.delete(jid);
                }
                setTimeout(() => {
                    restart().catch((err) =>
                        print.error(
                            `${phoneTag} restart failed: ${err.message}`,
                        ),
                    );
                }, 500);
                return;
            }

            if (jid) {
                sessions.delete(jid);
                print.warn(
                    `${phoneTag} disconnected (code=${statusCode}), reconnecting in 5s`,
                );
                setTimeout(() => {
                    restart().catch((err) =>
                        print.error(
                            `${phoneTag} reconnect failed: ${err.message}`,
                        ),
                    );
                }, 5000);
            } else {
                print.warn(
                    `${phoneTag} closed before pairing (code=${statusCode}, err=${lastDisconnect?.error?.message})`,
                );
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

            print.message(msg, false, mainClient.store, { clone: true });

            processMessage(
                {
                    sock,
                    sendMessage: (j, c, o) => sock.sendMessage(j, c, o),
                    db: mainClient.db,
                    store: mainClient.store,
                    groupCache: mainClient.groupCache,
                    ephemeralCache: mainClient.ephemeralCache,
                    messageCache: mainClient.messageCache,
                    stats: mainClient.stats,
                    generateMsgId: () => mainClient.generateMsgId(),
                    _isClone: true,
                    _cloneOwner: ownerJid,
                },
                msg,
            );
        }
    });
}

/**
 * Build a fresh Baileys socket for a clone.
 * @param {object} creds
 * @param {object} keys
 */
async function buildSocket(creds, keys) {
    const { version } = await fetchLatestBaileysVersion();
    return makeWASocket({
        version,
        auth: { creds, keys: makeCacheableSignalKeyStore(keys, cloneLogger) },
        browser: Browsers.macOS("Safari"),
        printQRInTerminal: false,
        logger: cloneLogger,
        markOnlineOnConnect: false,
        syncFullHistory: false,
    });
}

/**
 * Create a new clone session and request a pairing code.
 *
 * @param {string} ownerJid
 * @param {import('../../../handlers/Client.js').Client} mainClient
 * @returns {Promise<string>} Pairing code (formatted with dashes).
 */
export async function createClone(ownerJid, mainClient) {
    const phoneNumber = ownerJid.split("@")[0];
    const tag = `[clone:${phoneNumber}]`;

    const existing = store.getByOwner(ownerJid);
    if (existing && sessions.has(existing.jid)) {
        throw new Error("You already have an active clone.");
    }

    if (existing) {
        store.delete(existing.jid);
    }

    const creds = initAuthCreds();
    const keys = createKeyStore();

    let sock = await buildSocket(creds, keys);

    const restart = async () => {
        sock = await buildSocket(creds, keys);
        bindCloneEvents({
            ownerJid,
            creds,
            keys,
            sock,
            mainClient,
            knownJid: creds.me?.id,
            restart,
        });
    };

    const codePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Pairing code request timeout (30s)."));
        }, 30_000);

        let requested = false;
        const handler = async (update) => {
            if (
                requested ||
                update.connection !== "connecting" ||
                creds.registered
            ) {
                return;
            }
            requested = true;

            try {
                await new Promise((r) => setTimeout(r, 3000));
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                clearTimeout(timeout);
                sock.ev.off("connection.update", handler);
                resolve(code);
            } catch (err) {
                print.error(`${tag} requestPairingCode failed: ${err.message}`);
                clearTimeout(timeout);
                sock.ev.off("connection.update", handler);
                reject(err);
            }
        };
        sock.ev.on("connection.update", handler);
    });

    bindCloneEvents({ ownerJid, creds, keys, sock, mainClient, restart });

    try {
        return await codePromise;
    } catch (err) {
        try {
            sock.end(undefined);
        } catch {}
        throw err;
    }
}

async function startCloneFromRow(row, mainClient) {
    const { creds, keys: rawKeys } = parseAuth(row);
    const keys = createKeyStore(rawKeys);
    let sock = await buildSocket(creds, keys);

    const restart = async () => {
        sock = await buildSocket(creds, keys);
        bindCloneEvents({
            ownerJid: row.owner_jid,
            creds,
            keys,
            sock,
            mainClient,
            knownJid: row.jid,
            restart,
        });
    };

    bindCloneEvents({
        ownerJid: row.owner_jid,
        creds,
        keys,
        sock,
        mainClient,
        knownJid: row.jid,
        restart,
    });
}

function destroySession(jid) {
    const session = sessions.get(jid);
    if (session) {
        stoppedJids.add(jid);
        try {
            session.sock.end(undefined);
        } catch {}
        sessions.delete(jid);
    }
}

/** @param {string} jid */
export function deleteClone(jid) {
    stoppedJids.add(jid);
    destroySession(jid);
    store.delete(jid);
}

/** @param {string} ownerJid */
export function deleteCloneByOwner(ownerJid) {
    const row = store.getByOwner(ownerJid);
    if (row) {
        // Mark as stopped even if no live session (covers in-flight restarts)
        stoppedJids.add(row.jid);
        destroySession(row.jid);
        store.delete(row.jid);
        return true;
    }
    return false;
}

export function listClones() {
    return store.getAllActive().map((r) => ({
        jid: r.jid,
        owner: r.owner_jid,
        created: r.created_at,
    }));
}

/** @param {string} ownerJid */
export function getCloneByOwner(ownerJid) {
    const row = store.getByOwner(ownerJid);
    if (!row) {
        return null;
    }
    return {
        jid: row.jid,
        owner: row.owner_jid,
        active: sessions.has(row.jid),
    };
}

/** @param {string} jid */
export function isCloneSession(jid) {
    return sessions.has(jid);
}

/**
 * @param {import('../../../handlers/Client.js').Client} mainClient
 */
export async function restoreClones(mainClient) {
    const rows = store.getAllActive();
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
