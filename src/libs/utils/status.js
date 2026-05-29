/**
 * @fileoverview Shared status/story utilities and in-memory store.
 * Captures incoming status messages and provides access for commands.
 * @module libs/utils/status
 */

/** In-memory store for recent status messages. Key = sender JID */
const statusStore = new Map();
const MAX_SENDERS = 100;
const MAX_PER_USER = 10;

/**
 * Capture an incoming status message. Call this from the message handler
 * when remoteJid === "status@broadcast".
 *
 * @param {object} msg - WAMessage from messages.upsert event
 */
export function captureStatus(msg) {
    if (msg.key?.remoteJid !== "status@broadcast") {
        return;
    }

    const sender = msg.key.participant || msg.key.remoteJid;
    if (!sender || sender === "status@broadcast") {
        return;
    }

    if (!statusStore.has(sender)) {
        statusStore.set(sender, []);
    }

    const list = statusStore.get(sender);
    list.push({
        key: msg.key,
        message: msg.message,
        timestamp: msg.messageTimestamp
            ? typeof msg.messageTimestamp === "number"
                ? msg.messageTimestamp
                : Number(msg.messageTimestamp)
            : Math.floor(Date.now() / 1000),
        pushName: msg.pushName || "Unknown",
    });

    if (list.length > MAX_PER_USER) {
        list.shift();
    }

    if (statusStore.size > MAX_SENDERS) {
        const oldest = statusStore.keys().next().value;
        statusStore.delete(oldest);
    }
}

/**
 * Get all senders who have posted stories.
 *
 * @returns {Array<{ jid: string, pushName: string, count: number, lastTimestamp: number }>}
 */
export function getStatusSenders() {
    return [...statusStore.entries()].map(([jid, stories]) => ({
        jid,
        pushName: stories[stories.length - 1]?.pushName || "Unknown",
        count: stories.length,
        lastTimestamp: stories[stories.length - 1]?.timestamp || 0,
    }));
}

/**
 * Get all stories from a specific sender.
 *
 * @param {string} jid - Sender JID
 * @returns {Array<{ key: object, message: object, timestamp: number, pushName: string }>}
 */
export function getStoriesFrom(jid) {
    return statusStore.get(jid) || [];
}

/**
 * Get the latest story from a specific sender.
 *
 * @param {string} jid - Sender JID
 * @returns {{ key: object, message: object, timestamp: number, pushName: string } | null}
 */
export function getLatestStory(jid) {
    const list = statusStore.get(jid);
    if (!list?.length) {
        return null;
    }
    return list[list.length - 1];
}

/**
 * Clear all captured stories.
 */
export function clearStatusStore() {
    statusStore.clear();
}

/**
 * Get the list of JIDs to use as status audience from a client instance.
 * Tries contacts from store, falls back to group participants.
 *
 * @param {object} client - Client instance
 * @param {object} sock - WASocket instance
 * @returns {Promise<string[]>}
 */
export async function getStatusAudience(client, sock) {
    const jids = new Set();

    const contacts = client.store.getAllContacts?.() || [];
    for (const c of contacts) {
        if (c.id?.endsWith("@s.whatsapp.net")) {
            jids.add(c.id);
        }
    }

    if (jids.size === 0) {
        try {
            const groups = await sock.groupFetchAllParticipating();
            for (const meta of Object.values(groups)) {
                for (const p of meta.participants || []) {
                    if (p.id?.endsWith("@s.whatsapp.net")) {
                        jids.add(p.id);
                    }
                }
            }
        } catch {
            const allGroups = client.store.getAllGroups?.() || [];
            for (const g of allGroups) {
                for (const p of g.participants || []) {
                    if (p.id?.endsWith("@s.whatsapp.net")) {
                        jids.add(p.id);
                    }
                }
            }
        }
    }

    const botJid = sock.user?.id;
    if (botJid) {
        jids.delete(botJid);
        const normalized = botJid.replace(/:.*@/, "@");
        jids.delete(normalized);
    }

    return [...jids];
}
