import { areJidsSameUser } from "baileys";
import config from "#config";

/**
 * Strict owner check — compares the message sender against the configured
 * owner JID/LID. `fromMe` is treated as "the bot account sent this", which is
 * only equivalent to ownership when the bot account *is* the owner.
 *
 * @param {import('#structures/Interaction.js').Interaction} i
 * @returns {boolean}
 */
export function isOwner(i) {
    const { ownerJids, ownerLids } = config;
    if (!ownerJids.length && !ownerLids.length) {
        return false;
    }

    const jid = senderJid(i);
    if (!jid) {
        return false;
    }

    for (const owner of ownerJids) {
        if (matchesJid(jid, owner)) {
            return true;
        }
    }
    for (const lid of ownerLids) {
        if (matchesJid(jid, lid)) {
            return true;
        }
    }

    return false;
}

/** Resolve the effective sender JID for an interaction. */
function senderJid(i) {
    if (i.msg.key.fromMe) {
        return i.sock.user?.id ?? "";
    }
    if (i.isGroup) {
        return i.msg.key.participant ?? "";
    }
    return i.msg.key.remoteJid ?? "";
}

/** True if `a` and `b` reference the same WhatsApp account. */
function matchesJid(a, b) {
    if (!b) {
        return false;
    }
    if (a === b) {
        return true;
    }
    try {
        return areJidsSameUser(a, b);
    } catch {
        return false;
    }
}
