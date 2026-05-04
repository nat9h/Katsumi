import {
	extractMessageContent,
	getContentType,
	jidNormalizedUser,
	proto,
} from "baileys";
import { createHash } from "node:crypto";

const MESSAGE_EDIT = proto?.Message?.ProtocolMessage?.Type?.MESSAGE_EDIT ?? 14;

/**
 * Safely normalize a WhatsApp JID.
 *
 * @param {string | null | undefined} jid Raw JID.
 * @returns {string} Normalized JID, or empty string if invalid.
 */
export function safeNorm(jid) {
	if (!jid || typeof jid !== "string") {
		return "";
	}

	try {
		return jidNormalizedUser(jid);
	} catch {
		return jid;
	}
}

/**
 * Create SHA-1 hash from a string.
 *
 * @param {string | number | null | undefined} value Value to hash.
 * @returns {string} Hex digest.
 */
export function hashString(value) {
	return createHash("sha1")
		.update(String(value || ""))
		.digest("hex");
}

/**
 * Extract readable text/body from a message payload.
 *
 * @param {any} message Raw or nested message.
 * @returns {string} Extracted text.
 */
export function getMessageText(message) {
	if (!message) {
		return "";
	}

	const content = extractMessageContent(message) || message;
	const type = getContentType(content) || Object.keys(content || {})[0] || "";
	const node = type ? content?.[type] : content;

	return String(
		node?.text ||
			node?.conversation ||
			node?.caption ||
			content?.conversation ||
			node?.selectedButtonId ||
			node?.singleSelectReply?.selectedRowId ||
			node?.selectedId ||
			node?.contentText ||
			node?.selectedDisplayText ||
			node?.title ||
			node?.name ||
			""
	).trim();
}

/**
 * Extract edited-message payload from raw Baileys message or update payload.
 *
 * @param {any} message Raw message/update payload.
 * @returns {any | null} Edited message payload, or null if not an edit.
 */
export function getEditPayload(message) {
	if (!message || typeof message !== "object") {
		return null;
	}

	const content = extractMessageContent(message) || message;
	const protocol = content?.protocolMessage || message?.protocolMessage;

	if (
		protocol?.editedMessage &&
		(protocol?.type === MESSAGE_EDIT || protocol?.type === 14)
	) {
		return protocol.editedMessage;
	}

	if (content?.editedMessage?.message) {
		return content.editedMessage.message;
	}

	if (message?.editedMessage?.message) {
		return message.editedMessage.message;
	}

	return null;
}

/**
 * Build dedupe key for messages.upsert entries.
 *
 * @param {any} msg Baileys WebMessageInfo.
 * @returns {string} Dedupe cache key.
 */
export function getUpsertDedupeKey(msg) {
	const remoteJid = safeNorm(msg?.key?.remoteJid);
	const participant = safeNorm(msg?.key?.participant);
	return `upsert:${remoteJid}:${participant}:${msg?.key?.id}`;
}

/**
 * Resolve sender key for edit dedupe.
 *
 * @param {any} key Baileys message key.
 * @param {any} old Stored original message.
 * @param {string} remoteJid Chat JID.
 * @returns {string} Sender identifier.
 */
export function getSenderKey(key, old, remoteJid) {
	return (
		safeNorm(key?.participant) ||
		safeNorm(old?.key?.participant) ||
		safeNorm(old?.participant) ||
		safeNorm(old?.sender) ||
		safeNorm(remoteJid) ||
		"unknown"
	);
}
