/**
 * @fileoverview Advanced event listeners: poll votes, WebSocket sniffing,
 * message revoke detection, and reaction tracking.
 * @module handlers/core/listeners
 */

import { getAggregateVotesInPollMessage } from "baileys";
import logger, { print } from "#libs/utils/logger";

/**
 * Handle poll vote updates. Decrypts poll votes and emits a structured event.
 *
 * @param {import('../Client.js').Client} client
 * @param {{ key: object, pollUpdates: object[], remoteJid: string }} data
 */
export function handlePollVote(client, data) {
    const { key, pollUpdates, remoteJid } = data;

    const cached = client.messageCache.get(`${remoteJid}_${key.id}`);
    const pollCreationMessage = cached?.message || cached;

    if (!pollCreationMessage) {
        print.info(
            `[poll] Vote received but original poll not cached (${key.id?.slice(0, 12)})`,
        );
        return;
    }

    try {
        const votes = getAggregateVotesInPollMessage({
            message: pollCreationMessage,
            pollUpdates,
        });

        if (!votes?.length) {
            return;
        }

        const summary = votes
            .filter((v) => v.voters?.length > 0)
            .map((v) => `${v.name}: ${v.voters.length} vote(s)`)
            .join(", ");

        print.info(`[poll] ${remoteJid} → ${summary}`);

        client.emit("pollVote", {
            key,
            remoteJid,
            votes,
            pollUpdates,
        });
    } catch (err) {
        logger.warn({ err }, "poll vote decryption failed");
    }
}

/**
 * Register low-level WebSocket callbacks for monitoring raw protocol events.
 * These are useful for debugging and catching events Baileys doesn't expose.
 *
 * @param {import('../Client.js').Client} client
 */
export function registerWebSocketListeners(client) {
    const { sock } = client;
    if (!sock?.ws) {
        return;
    }

    // Monitor encryption key changes (number change / reinstall)
    sock.ws.on("CB:notification,type:encrypt", (node) => {
        const from = node?.attrs?.from || "unknown";
        print.warn(`[ws] Encryption key changed: ${from.split("@")[0]}`);
        client.emit("encryptionChange", { from, node });
    });

    // Monitor account sync notifications
    sock.ws.on("CB:notification,type:account_sync", (node) => {
        print.info("[ws] Account sync notification received");
        client.emit("accountSync", { node });
    });

    // Monitor server error notifications
    sock.ws.on("CB:notification,type:server_error", (node) => {
        print.warn(
            `[ws] Server error notification: ${JSON.stringify(node?.attrs || {})}`,
        );
        client.emit("serverError", { node });
    });

    // Monitor privacy settings changes
    sock.ws.on("CB:notification,type:privacy", (node) => {
        print.info("[ws] Privacy settings update received");
        client.emit("privacyUpdate", { node });
    });

    // Monitor device list changes (new device linked/unlinked)
    sock.ws.on("CB:notification,type:devices", (node) => {
        print.info("[ws] Device list changed");
        client.emit("devicesUpdate", { node });
    });

    // Monitor receipt events (read receipts, played receipts)
    sock.ws.on("CB:receipt", (node) => {
        const type = node?.attrs?.type; // 'read', 'read-self', 'played'
        const from = node?.attrs?.from || "";
        if (type === "read" || type === "played") {
            client.emit("receiptUpdate", {
                type,
                from,
                participant: node?.attrs?.participant,
                messageIds:
                    node?.content?.map((c) => c?.attrs?.id).filter(Boolean) ||
                    [],
            });
        }
    });
}

/**
 * Handle message revoke/delete-for-everyone events.
 * Attempts to retrieve the original message from cache before it's gone.
 *
 * @param {import('../Client.js').Client} client
 * @param {object} msg - The incoming protocol message containing the revoke
 */
export function handleMessageRevoke(client, msg) {
    const protoMsg =
        msg.message?.protocolMessage ||
        msg.message?.ephemeralMessage?.message?.protocolMessage;

    if (!protoMsg) {
        return null;
    }

    const isRevoke =
        protoMsg.type === 0 ||
        protoMsg.type === "REVOKE" ||
        protoMsg.type === "MESSAGE_DELETION";

    if (!isRevoke) {
        return null;
    }

    const deletedKey = protoMsg.key;
    if (!deletedKey) {
        return null;
    }

    const chatJid = deletedKey.remoteJid || msg.key.remoteJid;
    const deletedMsgId = deletedKey.id;
    const deletedBy = msg.key.participant || msg.key.remoteJid;

    const cached = client.messageCache.get(`${chatJid}_${deletedMsgId}`);
    const originalMessage = cached?.message || cached;

    const revokeData = {
        chatJid,
        deletedMsgId,
        deletedBy,
        deletedKey,
        originalMessage: originalMessage || null,
        timestamp: msg.messageTimestamp,
    };

    if (originalMessage) {
        const text =
            originalMessage.conversation ||
            originalMessage.extendedTextMessage?.text ||
            originalMessage.imageMessage?.caption ||
            originalMessage.videoMessage?.caption ||
            null;

        const type = Object.keys(originalMessage).find(
            (k) => k !== "messageContextInfo",
        );

        print.info(
            `[revoke] ${deletedBy?.split("@")[0]} deleted ${type || "message"} in ${chatJid?.split("@")[0]}${text ? `: "${text.slice(0, 50)}"` : ""}`,
        );
    } else {
        print.info(
            `[revoke] ${deletedBy?.split("@")[0]} deleted msg ${deletedMsgId?.slice(0, 12)} in ${chatJid?.split("@")[0]} (not cached)`,
        );
    }

    client.emit("messageRevoke", revokeData);
    return revokeData;
}

/**
 * Handle reaction events from messages.reaction or messages.upsert.
 *
 * @param {import('../Client.js').Client} client
 * @param {object[]} reactions - Array of reaction events
 */
export function handleReactions(client, reactions) {
    for (const reaction of reactions) {
        const { key, reaction: reactionData } = reaction;

        if (!reactionData) {
            continue;
        }

        const emoji = reactionData.text;
        const reactedBy =
            reactionData.key?.participant || reactionData.key?.remoteJid;
        const targetMsgId = key?.id;
        const chatJid = key?.remoteJid;

        const isRemoval = !emoji;

        if (isRemoval) {
            print.info(
                `[reaction] ${reactedBy?.split("@")[0]} removed reaction in ${chatJid?.split("@")[0]}`,
            );
        } else {
            print.info(
                `[reaction] ${reactedBy?.split("@")[0]} reacted ${emoji} in ${chatJid?.split("@")[0]}`,
            );
        }

        client.emit("reactionUpdate", {
            emoji: emoji || null,
            reactedBy,
            targetMsgId,
            chatJid,
            isRemoval,
            raw: reaction,
        });
    }
}

/**
 * Detect reactions from messages.upsert (reactionMessage type).
 *
 * @param {import('../Client.js').Client} client
 * @param {object} msg - Raw message object
 * @returns {boolean} true if this was a reaction message
 */
export function detectReactionFromUpsert(client, msg) {
    const reactionMsg =
        msg.message?.reactionMessage ||
        msg.message?.ephemeralMessage?.message?.reactionMessage;

    if (!reactionMsg) {
        return false;
    }

    const emoji = reactionMsg.text;
    const targetKey = reactionMsg.key;
    const reactedBy = msg.key.participant || msg.key.remoteJid;
    const chatJid = msg.key.remoteJid;
    const isRemoval = !emoji;

    if (isRemoval) {
        print.info(
            `[reaction] ${reactedBy?.split("@")[0]} removed reaction in ${chatJid?.split("@")[0]}`,
        );
    } else {
        print.info(
            `[reaction] ${reactedBy?.split("@")[0]} reacted ${emoji} to msg ${targetKey?.id?.slice(0, 12)} in ${chatJid?.split("@")[0]}`,
        );
    }

    client.emit("reactionUpdate", {
        emoji: emoji || null,
        reactedBy,
        targetMsgId: targetKey?.id,
        targetKey,
        chatJid,
        isRemoval,
        raw: msg,
    });

    return true;
}
