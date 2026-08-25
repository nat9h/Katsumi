import { areJidsSameUser, jidNormalizedUser, proto } from "baileys";
import config from "#config";
import {
    detectReactionFromUpsert,
    handleMessageRevoke,
} from "#handlers/core/listeners";
import { print } from "#libs/utils/logger";
import { extractExpiration, extractText } from "#libs/utils/message";
import {
    decryptSecretEdit,
    isSecretEdit,
    storeSecret,
} from "#libs/utils/secret";
import { captureStatus } from "#libs/utils/status";
import { processMessage } from "#middleware";

const pairingJid = config.pairingNumber
    ? `${config.pairingNumber.replace(/\D/g, "")}@s.whatsapp.net`
    : null;

/**
 * @param {import('../Client.js').Client} client
 * @param {object} msg
 * @returns {boolean}
 */
function isOwnEcho(client, msg) {
    if (!msg.key.fromMe) {
        return false;
    }
    if (client.wasSentByMe?.(msg.key.id)) {
        return true;
    }
    if (!config.selfMode) {
        return !isBotOwner();
    }
    return false;
}

/**
 * Check if the bot's own number is listed as an owner.
 * This handles the case where PAIRING_NUMBER == OWNER_JID.
 *
 * @returns {boolean}
 */
function isBotOwner() {
    if (!pairingJid) {
        return false;
    }
    for (const owner of config.ownerJids) {
        if (owner === pairingJid) {
            return true;
        }
        try {
            if (areJidsSameUser(pairingJid, owner)) {
                return true;
            }
        } catch {
            return false;
        }
    }
    return false;
}

/**
 * @param {string|undefined} jid
 * @returns {boolean}
 */
function isDmJid(jid) {
    return (
        jid?.endsWith("@s.whatsapp.net") ||
        jid?.endsWith("@lid") ||
        jid?.endsWith("@c.us")
    );
}

/**
 * Look up ephemeral expiration from the cache, trying both the raw JID
 * and its normalized form (@lid vs @s.whatsapp.net).
 *
 * @param {import('../Client.js').Client} client
 * @param {string} jid
 * @returns {number}
 */
function getCachedExpiration(client, jid) {
    if (!jid) {
        return 0;
    }
    const direct = client.ephemeralCache.get(jid);
    if (direct) {
        return direct;
    }
    try {
        const norm = jidNormalizedUser(jid);
        if (norm && norm !== jid) {
            return client.ephemeralCache.get(norm) || 0;
        }
    } catch {}
    return 0;
}

/**
 * Update the ephemeral cache from an incoming message.
 * protocolMessage EPHEMERAL_SETTING (type 3) is authoritative.
 * For DMs, contextInfo.expiration on the message content is also reliable.
 * Groups are skipped — their duration comes from groupMetadata.
 *
 * @param {import('../Client.js').Client} client
 * @param {object} msg
 */
function syncEphemeral(client, msg) {
    const chatJid = msg.key.remoteJid;
    if (!chatJid) {
        return;
    }

    const proto = msg.message?.protocolMessage;
    if (proto) {
        if (proto.type === 3 || proto.type === "EPHEMERAL_SETTING") {
            const exp = proto.ephemeralExpiration || 0;
            if (exp > 0) {
                client.ephemeralCache.set(chatJid, exp);
            } else {
                client.ephemeralCache.delete(chatJid);
            }
        }
        return;
    }

    if (!isDmJid(chatJid) || client.ephemeralCache.get(chatJid)) {
        return;
    }

    const inner = msg.message?.ephemeralMessage?.message;
    if (inner) {
        for (const v of Object.values(inner)) {
            const exp = v?.contextInfo?.expiration;
            if (exp && exp > 0) {
                client.ephemeralCache.set(chatJid, exp);
                return;
            }
        }
    }

    const message = msg.message;
    if (message) {
        for (const v of Object.values(message)) {
            if (v && typeof v === "object" && !Array.isArray(v)) {
                const exp = v.contextInfo?.expiration;
                if (exp && exp > 0) {
                    client.ephemeralCache.set(chatJid, exp);
                    return;
                }
            }
        }
    }
}

/**
 * @param {import('../Client.js').Client} client
 * @param {object} msg
 */
function recordStats(client, msg) {
    client.stats.bump();

    const chatJid = msg.key.remoteJid;
    if (!chatJid?.endsWith("@g.us")) {
        return;
    }

    const sender = msg.key.participant;
    if (sender) {
        client.stats.bumpGroup(chatJid, sender);
    }
}

/**
 * Feed an edited message back through the middleware as if it had just
 * arrived, so a corrected command still runs.
 *
 * Shared by both edit paths (secret-encrypted and protocolMessage), which
 * differ only in how they locate the content and the target key.
 *
 * @param {import('../Client.js').Client} client
 * @param {object} msg - The carrier message the edit arrived on.
 * @param {object} opts
 * @param {object} opts.content - Unwrapped edited content.
 * @param {object} [opts.targetKey] - Key of the message being edited.
 * @param {string} opts.remoteJid - Chat the edit belongs to.
 * @param {string} [opts.participant] - Sender, for groups.
 * @param {string} opts.tag - Log tag distinguishing the two paths.
 */
function reprocessEdit(
    client,
    msg,
    { content, targetKey, remoteJid, participant, tag },
) {
    const text = extractText(content);
    if (!text) {
        return;
    }

    // In self-DM, force fromMe true when the chat JID is the bot's own JID.
    let fromMe = msg.key.fromMe ?? targetKey?.fromMe ?? false;
    if (
        !fromMe &&
        isDmJid(remoteJid) &&
        client.sock?.user?.id &&
        areJidsSameUser(remoteJid, client.sock.user.id)
    ) {
        fromMe = true;
    }

    processMessage(client, {
        key: {
            remoteJid,
            id: targetKey?.id || msg.key.id,
            fromMe,
            participant,
        },
        message: content,
        pushName: msg.pushName,
        messageTimestamp: msg.messageTimestamp,
        _isEditReprocess: true,
        _expiration:
            extractExpiration(msg.message) ||
            getCachedExpiration(client, remoteJid) ||
            0,
    });

    print.info(`[${tag}] re-processing "${text}" from ${remoteJid}`);
}

/**
 * Decrypt and re-process a SecretEncryptedMessage edit.
 * Self-edits (fromMe) can't be decrypted — WA doesn't share the
 * messageSecret with the sender's own linked devices.
 *
 * @param {import('../Client.js').Client} client
 * @param {object} msg
 */
function handleSecretEdit(client, msg) {
    const meId = client.sock?.user?.id;
    const meLid = client.sock?.user?.lid;
    const decoded = decryptSecretEdit(msg, { meId, meLid });
    if (!decoded) {
        return;
    }

    let content = decoded;

    if (content.editedMessage?.message) {
        content = content.editedMessage.message;
    }
    if (content.protocolMessage?.editedMessage) {
        content = content.protocolMessage.editedMessage;
    }
    if (content.ephemeralMessage?.message) {
        content = content.ephemeralMessage.message;
    }

    if (content.messageContextInfo) {
        const { messageContextInfo: _ctx, ...rest } = content;
        if (Object.keys(rest).some((k) => rest[k] != null)) {
            content = rest;
        }
    }

    const targetKey = msg.message.secretEncryptedMessage.targetMessageKey;
    const isGroup = (targetKey?.remoteJid || msg.key.remoteJid || "").endsWith(
        "@g.us",
    );

    const remoteJid = isGroup
        ? targetKey?.remoteJid || msg.key.remoteJid
        : msg.key.remoteJid || targetKey?.remoteJid;

    reprocessEdit(client, msg, {
        content,
        targetKey,
        remoteJid,
        participant: isGroup
            ? targetKey?.participant || msg.key.participant
            : undefined,
        tag: "edit",
    });
}

/**
 * @param {import('../Client.js').Client} client
 * @param {{ type: string, messages: object[] }} payload
 */
export async function handleMessagesUpsert(client, { type, messages }) {
    if (type !== "notify") {
        return;
    }

    for (const msg of messages) {
        if (!msg.message) {
            continue;
        }

        if (msg.key?.remoteJid === "status@broadcast") {
            captureStatus(msg);
            continue;
        }

        syncEphemeral(client, msg);
        storeSecret(msg);

        if (isSecretEdit(msg)) {
            handleSecretEdit(client, msg);
            continue;
        }

        const innerMessage =
            msg.message?.ephemeralMessage?.message || msg.message;

        // Only reachable when the secret edit sat inside an ephemeral
        // wrapper — the unwrapped case already `continue`d above.
        if (innerMessage?.secretEncryptedMessage) {
            const secretEncType =
                innerMessage.secretEncryptedMessage.secretEncType;
            const editType =
                proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT;
            if (
                secretEncType === editType ||
                secretEncType === 2 ||
                secretEncType === "MESSAGE_EDIT"
            ) {
                const originalMessage = msg.message;
                msg.message = innerMessage;
                handleSecretEdit(client, msg);
                msg.message = originalMessage;
                continue;
            }
        }

        const protoMsg =
            innerMessage?.protocolMessage || msg.message?.protocolMessage;
        if (protoMsg?.type === 14 || protoMsg?.type === "MESSAGE_EDIT") {
            if (protoMsg.editedMessage) {
                const targetKey = protoMsg.key;
                reprocessEdit(client, msg, {
                    content: protoMsg.editedMessage,
                    targetKey,
                    remoteJid: targetKey?.remoteJid || msg.key.remoteJid,
                    participant: targetKey?.participant || msg.key.participant,
                    tag: "edit-proto",
                });
            }
            continue;
        }

        if (protoMsg) {
            const revoked = handleMessageRevoke(client, msg);
            if (revoked) {
                continue;
            }
        }

        if (detectReactionFromUpsert(client, msg)) {
            continue;
        }

        if (msg.key?.id && msg.key?.remoteJid) {
            client.messageCache.set(`${msg.key.remoteJid}_${msg.key.id}`, msg);
        }

        if (isOwnEcho(client, msg)) {
            continue;
        }

        print.message(msg, msg.key.fromMe === true, client.store);
        recordStats(client, msg);

        client.emit("messageCreate", msg);
        processMessage(client, msg);
    }
}
