import { state } from "./state.js";

/**
 * Normalize an owner JID string to include the WhatsApp suffix.
 * @param {string} raw - Raw owner identifier (number or full JID).
 * @returns {string} Normalized JID with @s.whatsapp.net suffix, or empty string.
 */
function normalizeOwner(raw) {
    if (!raw) {
        return "";
    }
    const trimmed = raw.trim();
    if (trimmed.includes("@")) {
        return trimmed;
    }
    return `${trimmed}@s.whatsapp.net`;
}

/**
 * Parse comma-separated owner values into an array of normalized JIDs.
 * @param {string} raw - Comma-separated owner identifiers.
 * @returns {string[]}
 */
function parseOwners(raw) {
    if (!raw) {
        return [];
    }
    return raw
        .split(",")
        .map((s) => normalizeOwner(s))
        .filter(Boolean);
}

/**
 * Parse comma-separated LID values.
 * @param {string} raw
 * @returns {string[]}
 */
function parseLids(raw) {
    if (!raw) {
        return [];
    }
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * @typedef {object} AppConfig
 * @property {string} authDir - Directory for auth credentials storage.
 * @property {string} pairingNumber - Phone number for pairing code authentication.
 * @property {number} pairingDelay - Delay before requesting pairing code (ms).
 * @property {string} dbType - Database backend type ("sqlite" or "json").
 * @property {string} dbPath - Path to the database file.
 * @property {string} logLevel - Pino log level.
 * @property {string[]} prefixes - Active command prefixes.
 * @property {string} ownerJid - Owner's normalized WhatsApp JID.
 * @property {string} ownerLid - Owner's LID (linked device ID).
 * @property {number} maxReconnectAttempts - Max reconnection attempts before exit.
 * @property {number} initialReconnectDelay - Base delay for exponential backoff (ms).
 * @property {boolean} storeContacts - Whether to persist contacts.
 * @property {boolean} storeGroups - Whether to persist group metadata.
 * @property {boolean} storeChats - Whether to persist chat metadata.
 * @property {string} botId - Unique bot instance identifier.
 * @property {boolean} selfMode - Whether to process own messages as commands.
 */

/** @type {AppConfig} */
const config = {
    get authDir() {
        return process.env.AUTH_DIR || "./auth_info_baileys";
    },
    get pairingNumber() {
        return process.env.PAIRING_NUMBER || "";
    },
    get pairingDelay() {
        return parseInt(process.env.PAIRING_DELAY || "5000", 10);
    },
    get loginMethod() {
        const m = (process.env.LOGIN_METHOD || "").trim().toLowerCase();
        if (m === "qr" || m === "pairing") {
            return m;
        }
        return process.env.PAIRING_NUMBER ? "pairing" : "qr";
    },
    get dbType() {
        return process.env.DB_TYPE || "sqlite";
    },
    get dbPath() {
        return process.env.DB_PATH || "./bot.db";
    },
    get logLevel() {
        return process.env.LOG_LEVEL || "silent";
    },
    get prefixes() {
        return state.prefixes;
    },
    get ownerJid() {
        return normalizeOwner(
            (process.env.OWNER_JID || "").split(",")[0]?.trim(),
        );
    },
    get ownerLid() {
        return (
            (process.env.OWNER_LID || "").split(",")[0]?.trim() ||
            state.ownerLid ||
            ""
        );
    },
    /** All owner JIDs (supports comma-separated in env). */
    get ownerJids() {
        return parseOwners(process.env.OWNER_JID);
    },
    /** All owner LIDs (supports comma-separated in env). */
    get ownerLids() {
        const envLids = parseLids(process.env.OWNER_LID);
        for (const lid of state.ownerLids || []) {
            if (!envLids.includes(lid)) {
                envLids.push(lid);
            }
        }
        if (state.ownerLid && !envLids.includes(state.ownerLid)) {
            envLids.push(state.ownerLid);
        }
        return envLids;
    },
    get maxReconnectAttempts() {
        return parseInt(process.env.MAX_RECONNECT || "10", 10);
    },
    get initialReconnectDelay() {
        return parseInt(process.env.RECONNECT_DELAY || "1000", 10);
    },
    get storeContacts() {
        return process.env.STORE_CONTACTS === "true";
    },
    get storeGroups() {
        return process.env.STORE_GROUPS === "true";
    },
    get storeChats() {
        return process.env.STORE_CHATS === "true";
    },
    get botId() {
        return state.botId;
    },
    get selfMode() {
        return state.selfMode;
    },
};

export default config;
