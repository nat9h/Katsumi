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
	execute: async (m, { groupMetadata, text }) => {
		const q = m.isQuoted ? m.quoted : m;
		const type = q.type || "";
		const mentions = groupMetadata.participants.map((p) => p.jid);
		let mediaBuffer, mediaType;

		if (isMediaMessage(type)) {
			try {
				mediaBuffer = await q.download();
				mediaType = mimeMap[type] || "document";
			} catch (e) {
				console.error("Error downloading media:", e);
			}
		}

		const message = text || q.text || q.caption || "";

		if (mediaType && mediaBuffer) {
			const mediaMsg = { [mediaType]: mediaBuffer, mentions };
			if (mediaType === "sticker" && message) {
				await m.reply(mediaMsg);
				return m.reply({ text: message, mentions });
			}
			if (message && mediaType !== "sticker") {
				mediaMsg.caption = message;
			}
			return m.reply(mediaMsg);
		}

		if (!message) {
			return m.reply({
				text: "Please provide text or reply to the media/message you want to hidetag!",
			});
		}

		return m.reply({ text: message, mentions });
	},
};
