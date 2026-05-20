import { downloadMediaMessage } from "baileys";
import { formatBytes } from "#libs/utils/format";

const URL_RE = /https?:\/\/[^\s<>"']+/i;

/**
 * Extract the first URL from a string or message object.
 *
 * @param {string|object|null|undefined} input
 * @returns {string|null}
 */
export function extractUrl(input) {
    if (!input) {
        return null;
    }
    const text = typeof input === "string" ? input : extractText(input);
    const match = text?.match(URL_RE);
    return match ? match[0] : null;
}

/**
 * Unwrap nested message containers (ephemeral, viewOnce, editedMessage,
 * documentWithCaption) and return the innermost message object.
 *
 * @param {object} message
 * @returns {object|null}
 */
export function unwrapMessage(message) {
    let m = message;
    for (let i = 0; i < 4 && m; i++) {
        if (m.ephemeralMessage?.message) {
            m = m.ephemeralMessage.message;
            continue;
        }
        if (m.editedMessage?.message) {
            m = m.editedMessage.message;
            continue;
        }
        if (m.viewOnceMessage?.message) {
            m = m.viewOnceMessage.message;
            continue;
        }
        if (m.viewOnceMessageV2?.message) {
            m = m.viewOnceMessageV2.message;
            continue;
        }
        if (m.viewOnceMessageV2Extension?.message) {
            m = m.viewOnceMessageV2Extension.message;
            continue;
        }
        if (m.documentWithCaptionMessage?.message) {
            m = m.documentWithCaptionMessage.message;
            continue;
        }
        break;
    }
    return m || null;
}

/**
 * Extract the plain text from a message, handling all common message types.
 *
 * @param {object} message
 * @returns {string}
 */
export function extractText(message) {
    const m = unwrapMessage(message);
    if (!m) {
        return "";
    }
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.buttonsResponseMessage?.selectedDisplayText ||
        m.buttonsResponseMessage?.selectedButtonId ||
        m.listResponseMessage?.title ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.templateButtonReplyMessage?.selectedDisplayText ||
        m.templateButtonReplyMessage?.selectedId ||
        m.interactiveResponseMessage?.body?.text ||
        m.eventResponseMessage?.response ||
        ""
    );
}

/**
 * Find the contextInfo object inside a message, searching all content fields.
 *
 * @param {object} message
 * @returns {object|null}
 */
export function findContextInfo(message) {
    const m = unwrapMessage(message);
    if (!m) {
        return null;
    }
    for (const key of Object.keys(m)) {
        const v = m[key];
        if (v && typeof v === "object" && v.contextInfo) {
            return v.contextInfo;
        }
    }
    return null;
}

/**
 * Returns true if the message is a view-once message in any of its variants.
 *
 * @param {object} message
 * @returns {boolean}
 */
export function isViewOnce(message) {
    if (!message) {
        return false;
    }
    return Boolean(
        message.viewOnceMessage ||
            message.viewOnceMessageV2 ||
            message.viewOnceMessageV2Extension ||
            Object.values(message).some((v) => v?.viewOnce),
    );
}

/**
 * Detect the media type of a message after unwrapping containers.
 * Also maps document mimetypes to image/video/audio where applicable.
 *
 * @param {object} message
 * @returns {{ type: string|null, msg: object|null }}
 */
export function detectMedia(message) {
    const m = unwrapMessage(message);
    if (!m) {
        return { type: null, msg: null };
    }

    if (m.imageMessage) {
        return { type: "image", msg: m };
    }
    if (m.videoMessage) {
        return { type: "video", msg: m };
    }
    if (m.stickerMessage) {
        return { type: "sticker", msg: m };
    }
    if (m.audioMessage) {
        return { type: "audio", msg: m };
    }
    if (m.ptvMessage) {
        return { type: "video", msg: m };
    }

    const doc = m.documentMessage;
    if (doc?.mimetype?.startsWith("image/")) {
        return { type: "image", msg: m };
    }
    if (doc?.mimetype?.startsWith("video/")) {
        return { type: "video", msg: m };
    }
    if (doc?.mimetype?.startsWith("audio/")) {
        return { type: "audio", msg: m };
    }
    if (doc) {
        return { type: "document", msg: m };
    }

    return { type: null, msg: null };
}

/**
 * Download media from the current or quoted message.
 * Throws with `err.code === "MEDIA_TOO_LARGE"` if the file exceeds maxBytes.
 *
 * @param {import('#structures/Interaction.js').Interaction} interaction
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<{ buffer: Buffer, type: string, size: number }|null>}
 */
export async function getMedia(
    interaction,
    { maxBytes = 30 * 1024 * 1024 } = {},
) {
    const { msg, quoted, chatJid } = interaction;

    let media = detectMedia(msg.message);
    let source = msg;

    if (!media.type && quoted) {
        media = detectMedia(quoted.message);
        const key = {
            remoteJid: chatJid,
            id: quoted.stanzaId,
            fromMe: false,
        };
        if (quoted.sender) {
            key.participant = quoted.sender;
        }
        source = { key, message: quoted.message };
    }

    if (!media.type) {
        return null;
    }

    const mediaMsg = media.msg;
    const declaredLen = Number(
        mediaMsg.imageMessage?.fileLength ||
            mediaMsg.videoMessage?.fileLength ||
            mediaMsg.audioMessage?.fileLength ||
            mediaMsg.stickerMessage?.fileLength ||
            mediaMsg.documentMessage?.fileLength ||
            0,
    );

    if (declaredLen && declaredLen > maxBytes) {
        const err = new Error(
            `Media too large (${formatBytes(declaredLen)} > ${formatBytes(maxBytes)})`,
        );
        err.code = "MEDIA_TOO_LARGE";
        throw err;
    }

    const buffer = await downloadMediaMessage(source, "buffer", {});

    if (buffer.length > maxBytes) {
        const err = new Error(
            `Media too large (${formatBytes(buffer.length)} > ${formatBytes(maxBytes)})`,
        );
        err.code = "MEDIA_TOO_LARGE";
        throw err;
    }

    return { buffer, type: media.type, size: buffer.length };
}

/**
 * Like `getMedia` but auto-replies with the error message on MEDIA_TOO_LARGE
 * and returns null, so callers can just do `if (!media) return;`.
 *
 * @param {import('#structures/Interaction.js').Interaction} interaction
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<{ buffer: Buffer, type: string, size: number }|null>}
 */
export async function fetchMedia(interaction, opts) {
    try {
        return await getMedia(interaction, opts);
    } catch (err) {
        if (err.code === "MEDIA_TOO_LARGE") {
            await interaction.reply(err.message);
            return null;
        }
        throw err;
    }
}

/**
 * Resolve a target user JID from mentions, quoted message, or a raw phone
 * number string.
 *
 * @param {import('#structures/Interaction.js').Interaction} interaction
 * @param {string} [raw] - Raw text that might contain a phone number
 * @returns {string|null}
 */
export function resolveUserTarget(interaction, raw) {
    const ctx = findContextInfo(interaction.msg.message);

    if (ctx?.mentionedJid?.length) {
        return ctx.mentionedJid[0];
    }
    if (ctx?.participant) {
        return ctx.participant;
    }

    if (!raw) {
        return null;
    }
    const digits = raw.trim().replace(/[^0-9]/g, "");
    if (digits.length >= 8 && digits.length < 18) {
        return `${digits}@s.whatsapp.net`;
    }
    return null;
}
