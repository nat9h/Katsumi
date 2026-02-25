import { isMediaMessage, mimeMap } from "#lib/media";

export default {
	name: "hidetag",
	description: "Send message with hidden tag (mention all members).",
	command: ["ht", "hidetag"],
	permissions: "admin",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "group",
	cooldown: 3,
	limit: false,
	usage: "$prefix$command <text> (or reply media)",
	react: false,
	botAdmin: false,
	group: true,
	private: false,
	owner: false,

	/**
	 * @param {object} m serialized message
	 * @param {{ text: string, sock: import('baileys').WASocket }} ctx
	 */
	execute: async (m, { text, sock, groupMetadata }) => {
		if (!groupMetadata?.participants?.length) {
			return m.reply("Group metadata not available.");
		}

		const q = m.isQuoted ? m.quoted : m;
		const type = q?.type || "";

		const message =
			(typeof text === "string" && text.trim()) ||
			q?.text ||
			q?.caption ||
			m.body ||
			"";

		const mentions = await sock.getGroupMentionJids(groupMetadata, {
			preferPn: true,
		});

		if (!mentions.length) {
			return m.reply("No valid participants found to mention.");
		}

		let mediaBuffer = null;
		let mediaType = null;

		if (isMediaMessage(type)) {
			mediaBuffer = await q.download();
			mediaType = mimeMap[type] || "document";
		}

		if (!message && !(mediaType && mediaBuffer)) {
			return m.reply("Please provide text or reply to media!");
		}

		const payload = { mentions };

		if (mediaType && mediaBuffer) {
			payload[mediaType] = mediaBuffer;
			if (mediaType !== "sticker" && message) {
				payload.caption = message;
			}
		} else {
			payload.text = message;
		}

		await sock.sendMessage(m.from, payload, {
			quoted: m,
			ephemeralExpiration: m.expiration,
		});
	},
};
