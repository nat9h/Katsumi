import { isMediaMessage, mimeMap } from "#lib/media";
import { generateWAMessageFromContent, jidNormalizedUser } from "baileys";

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
	usage: "$prefix$command <text>",
	react: false,
	botAdmin: false,
	group: true,
	private: false,
	owner: false,

	/**
	 * @param {import('baileys').WASocket} sock
	 * @param {object} m
	 * @param {object} options
	 */
	execute: async (m, { text, sock }) => {
		if (!m.metadata) {
			return m.reply("Group metadata not available.");
		}

		const q = m.isQuoted ? m.quoted : m;
		const type = q.type || "";
		let mediaBuffer, mediaType;

		if (isMediaMessage(type)) {
			try {
				mediaBuffer = await q.download();
				mediaType = mimeMap[type] || "document";
			} catch (e) {
				console.error("Media download error:", e);
			}
		}

		const message = text || q.text || q.caption || "";

		if (!message && (!mediaType || !mediaBuffer)) {
			return m.reply("Please provide text or reply to media!");
		}

		const mentions = m.metadata.participants
			.map((p) => {
				const target = p.phoneNumber || p.jid;
				if (
					target &&
					typeof target === "string" &&
					target.endsWith("@s.whatsapp.net")
				) {
					return jidNormalizedUser(target);
				}
				return null;
			})
			.filter(Boolean);

		if (mentions.length === 0) {
			return m.reply(
				"No valid participants with phone numbers found to mention."
			);
		}

		const content = {
			text: message,
			contextInfo: { mentionedJid: mentions },
		};

		if (mediaType && mediaBuffer) {
			content[mediaType] = mediaBuffer;
			if (mediaType !== "sticker") {
				content.caption = message;
				delete content.text;
			}
		}

		const msg = generateWAMessageFromContent(
			m.from,
			{ extendedTextMessage: content },
			{
				userJid: sock.user.id,
				quoted: m,
				ephemeralExpiration: m.expiration,
			}
		);

		await sock.relayMessage(m.from, msg.message, {
			messageId: msg.key.id,
		});
	},
};
