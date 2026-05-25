import { aesDecryptGCM, hmacSign, proto } from "baileys";

/**
 * @typedef {object} SecretEntry
 * @property {Buffer} secret
 * @property {string} participant
 * @property {number} timestamp
 */

/** @type {Map<string, SecretEntry>} */
const secretStore = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of secretStore) {
        if (now - entry.timestamp >= 15 * 60 * 1000) {
            secretStore.delete(id);
        }
    }
}, 60_000).unref();

/**
 * Find a stored secret by message ID. Tries an exact match first, then a
 * prefix match to handle cases where device IDs differ in length.
 *
 * @param {string} targetId
 * @returns {SecretEntry|undefined}
 */
function findSecret(targetId) {
    const exact = secretStore.get(targetId);
    if (exact) {
        return exact;
    }

    for (const [storedId, entry] of secretStore) {
        if (targetId.startsWith(storedId) || storedId.startsWith(targetId)) {
            return entry;
        }
    }
    return undefined;
}

/**
 * Pull the messageSecret out of an incoming message and store it so we can
 * decrypt any future edits to that message. Call this on every message.upsert.
 *
 * @param {object} msg - Raw Baileys WAMessage
 */
export function storeSecret(msg) {
    const message = msg?.message;
    if (!message) {
        return;
    }

    const secret =
        message?.messageContextInfo?.messageSecret ||
        message?.ephemeralMessage?.message?.messageContextInfo?.messageSecret ||
        message?.viewOnceMessage?.message?.messageContextInfo?.messageSecret;
    if (!secret) {
        return;
    }

    const key = msg.key;
    if (!key?.id) {
        return;
    }

    secretStore.set(key.id, {
        participant: key.participant || key.remoteJid,
        secret: Buffer.from(secret),
        timestamp: Date.now(),
    });
}

/**
 * Returns true if the message is a SecretEncryptedMessage with MESSAGE_EDIT type.
 *
 * @param {object} msg - Raw Baileys WAMessage
 * @returns {boolean}
 */
export function isSecretEdit(msg) {
    const secretEnc = msg?.message?.secretEncryptedMessage;
    if (!secretEnc) {
        return false;
    }
    const editType =
        proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT;
    return (
        secretEnc.secretEncType === editType ||
        secretEnc.secretEncType === 2 ||
        secretEnc.secretEncType === "MESSAGE_EDIT"
    );
}

/**
 * Decrypt a SecretEncryptedMessage (MESSAGE_EDIT) and return the decoded
 * message content, or null if decryption fails.
 *
 * Key derivation (from Baileys issue #2541):
 *   sign   = concat(targetId, sender, sender, "Message Edit", [1])
 *   key    = hmacSign(secret, new Uint8Array(32))
 *   decKey = hmacSign(sign, key)
 *   plain  = aesDecryptGCM(encPayload, decKey, encIv, '')
 *
 * @param {object} msg - Raw Baileys WAMessage containing secretEncryptedMessage
 * @param {{ meId?: string, meLid?: string }} [opts] - Bot's own JIDs for fromMe resolution
 * @returns {import('baileys').proto.IMessage|null}
 */
export function decryptSecretEdit(msg, opts) {
    const message = msg?.message;
    const secretEnc = message?.secretEncryptedMessage;
    if (!secretEnc) {
        return null;
    }

    const targetId = secretEnc.targetMessageKey?.id;
    if (!targetId) {
        return null;
    }

    const entry = findSecret(targetId);
    if (!entry) {
        return null;
    }

    try {
        const encPayload = Buffer.from(secretEnc.encPayload);
        const encIv = Buffer.from(secretEnc.encIv);

        let sender = msg.key?.participant || msg.key?.remoteJid;
        if (msg.key?.fromMe && !msg.key?.participant) {
            const remoteJid = msg.key.remoteJid || "";
            if (remoteJid.endsWith("@lid") && opts?.meLid) {
                sender = opts.meLid.replace(/:.*@/, "@");
            } else if (opts?.meId) {
                sender = opts.meId.replace(/:.*@/, "@");
            }
        }

        if (!sender) {
            return null;
        }

        const senderBuf = Buffer.from(sender);

        const sign = Buffer.concat([
            Buffer.from(targetId),
            senderBuf,
            senderBuf,
            Buffer.from("Message Edit"),
            new Uint8Array([1]),
        ]);

        const key = hmacSign(entry.secret, new Uint8Array(32));
        const decKey = hmacSign(sign, key);

        const decrypted = aesDecryptGCM(
            encPayload,
            decKey,
            encIv,
            Buffer.alloc(0),
        );
        const decoded = proto.Message.decode(decrypted);

        const result = proto.Message.toObject(decoded, {
            longs: Number,
            bytes: Buffer,
            defaults: false,
        });

        const newSecret =
            decoded?.messageContextInfo?.messageSecret ||
            result?.messageContextInfo?.messageSecret;
        if (newSecret) {
            entry.secret = Buffer.from(newSecret);
            entry.timestamp = Date.now();
        }

        return result;
    } catch {
        return null;
    }
}
