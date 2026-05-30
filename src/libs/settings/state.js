import { randomBytes } from "node:crypto";

const BOT_ID_PREFIX = "KTSM";
const DEFAULT_PREFIXES = (process.env.PREFIX || "!")
    .split(",")
    .map((p) => p.trim());

/** Boolean toggles. The key is the property name; the setter is `set<Capitalized>`. */
const TOGGLES = [
    "selfMode",
    "adminOnly",
    "privateOnly",
    "noPrefix",
    "antiCall",
    "autoRead",
    "warmup",
];

const generateBotId = () =>
    `${BOT_ID_PREFIX}-${randomBytes(3).toString("hex")}`;
const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

/** Internal mutable state. Reset via `state.init(db)`. */
const data = {
    botId: null,
    ownerLid: null,
    ownerLids: [],
    prefixes: [...DEFAULT_PREFIXES],
    bannedChats: new Set(),
    bannedUsers: new Set(),
    disabledPlugins: new Set(),
};
for (const key of TOGGLES) {
    data[key] = false;
}

let db = null;
const save = (key, value) => db?.set(`state:${key}`, value);

function hydrateBotId() {
    const stored = db.get("state:botId");
    if (stored && typeof stored === "string") {
        data.botId = stored;
    } else {
        data.botId = generateBotId();
        save("botId", data.botId);
    }
}

function hydrateBans() {
    const chats = db.get("state:bannedChats");
    if (Array.isArray(chats)) {
        data.bannedChats = new Set(chats);
    }

    const users = db.get("state:bannedUsers");
    if (Array.isArray(users)) {
        data.bannedUsers = new Set(users);
    }

    const plugins = db.get("state:disabledPlugins");
    if (Array.isArray(plugins)) {
        data.disabledPlugins = new Set(plugins);
    }
}

function hydratePrefixes() {
    const stored = db.get("state:prefixes");
    if (Array.isArray(stored) && stored.length) {
        data.prefixes = stored;
    }
}

/**
 * Runtime state singleton — toggles, bans, prefixes — persisted to KV.
 * Call `state.init(db)` once at startup.
 */
export const state = {
    init(kvStore) {
        db = kvStore;

        for (const key of TOGGLES) {
            data[key] = db.get(`state:${key}`) === true;
        }
        data.ownerLid = db.get("state:ownerLid") || null;
        data.ownerLids = db.get("state:ownerLids") || [];

        hydrateBotId();
        hydratePrefixes();
        hydrateBans();
    },

    get botId() {
        return data.botId;
    },
    get ownerLid() {
        return data.ownerLid;
    },
    get prefixes() {
        return data.prefixes;
    },

    setOwnerLid(lid) {
        data.ownerLid = lid || null;
        save("ownerLid", data.ownerLid);
        if (lid && !data.ownerLids.includes(lid)) {
            data.ownerLids.push(lid);
            save("ownerLids", data.ownerLids);
        }
    },

    addOwnerLid(lid) {
        if (!lid || data.ownerLids.includes(lid)) {
            return;
        }
        data.ownerLids.push(lid);
        save("ownerLids", data.ownerLids);
        if (!data.ownerLid) {
            data.ownerLid = lid;
            save("ownerLid", lid);
        }
    },

    get ownerLids() {
        return data.ownerLids;
    },

    addPrefix(p) {
        if (data.prefixes.includes(p)) {
            return;
        }
        data.prefixes.push(p);
        save("prefixes", data.prefixes);
    },
    removePrefix(p) {
        data.prefixes = data.prefixes.filter((x) => x !== p);
        save("prefixes", data.prefixes);
    },
    resetPrefixes() {
        data.prefixes = [...DEFAULT_PREFIXES];
        save("prefixes", data.prefixes);
    },

    banChat(jid) {
        data.bannedChats.add(jid);
        save("bannedChats", [...data.bannedChats]);
    },
    unbanChat(jid) {
        data.bannedChats.delete(jid);
        save("bannedChats", [...data.bannedChats]);
    },
    isChatBanned: (jid) => data.bannedChats.has(jid),
    getBannedChats: () => [...data.bannedChats],

    banUser(jid) {
        data.bannedUsers.add(jid);
        save("bannedUsers", [...data.bannedUsers]);
    },
    unbanUser(jid) {
        data.bannedUsers.delete(jid);
        save("bannedUsers", [...data.bannedUsers]);
    },
    isUserBanned: (jid) => data.bannedUsers.has(jid),
    getBannedUsers: () => [...data.bannedUsers],

    /**
     * Disable a plugin globally.
     * @param {string} name - Command name (primary name, not alias).
     */
    disablePlugin(name) {
        const set = data.disabledPlugins;
        set.add(name);
        save("disabledPlugins", [...set]);
    },

    /**
     * Enable a globally-disabled plugin.
     * @param {string} name
     */
    enablePlugin(name) {
        const set = data.disabledPlugins;
        set.delete(name);
        save("disabledPlugins", [...set]);
    },

    /** Check if a plugin is globally disabled. */
    isPluginDisabled(name) {
        return data.disabledPlugins.has(name);
    },

    /** List all globally disabled plugins. */
    getDisabledPlugins() {
        return [...data.disabledPlugins];
    },

    /**
     * Disable a plugin in a specific group.
     * @param {string} groupJid
     * @param {string} name - Command name.
     */
    disablePluginInGroup(groupJid, name) {
        const key = `disabledPlugins:${groupJid}`;
        const list = db?.get(key) || [];
        if (!list.includes(name)) {
            list.push(name);
            db?.set(key, list);
        }
    },

    /**
     * Enable a plugin in a specific group.
     * @param {string} groupJid
     * @param {string} name
     */
    enablePluginInGroup(groupJid, name) {
        const key = `disabledPlugins:${groupJid}`;
        const list = db?.get(key) || [];
        const filtered = list.filter((n) => n !== name);
        db?.set(key, filtered);
    },

    /** Check if a plugin is disabled in a specific group. */
    isPluginDisabledInGroup(groupJid, name) {
        const key = `disabledPlugins:${groupJid}`;
        const list = db?.get(key) || [];
        return list.includes(name);
    },

    /** List disabled plugins in a group. */
    getDisabledPluginsInGroup(groupJid) {
        const key = `disabledPlugins:${groupJid}`;
        return db?.get(key) || [];
    },
};

for (const key of TOGGLES) {
    Object.defineProperty(state, key, {
        get: () => data[key],
        enumerable: true,
    });
    state[`set${capitalize(key)}`] = (v) => {
        data[key] = Boolean(v);
        save(key, data[key]);
    };
}
