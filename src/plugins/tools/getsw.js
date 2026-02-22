export default {
	name: "getsw",
	description: "Retrieve and resend WhatsApp story (group or personal).",
	command: ["getsw", "ambilsw"],
	permissions: "all",
	category: "tools",
	cooldown: 3,
	wait: null,
	react: true,
	failed: "Failed to %command: %error",
	usage: "$prefix$command (reply to a status message)",

	/**
	 * Retrieves a WhatsApp Status (Story) from a quoted message.
	 *
	 * Supports:
	 * - Group story (groupStatusMessageV2)
	 * - Personal story (videoMessage, imageMessage, text)
	 *
	 * Behavior:
	 * - If group story → unwrap inner message.
	 * - If personal story → use message directly.
	 * - Only removes `contextInfo` to prevent status metadata conflict.
	 *
	 * Why only remove contextInfo?
	 * Because contextInfo contains status-related flags
	 * that can cause relay issues or make WhatsApp treat
	 * the message as a status again.
	 *
	 * @param {object} m - Serialized message object.
	 * @param {object} context - Command context.
	 * @param {import('baileys').WASocket} context.sock - Active Baileys socket.
	 * @returns {Promise<string>}
	 */
	execute: async (m, { sock }) => {
		if (!m.quoted || !m.quoted.message) {
			return m.reply("Please reply to a WhatsApp story!");
		}

		try {
			let msg = m.quoted.message;
			let type = Object.keys(msg)[0];
			let content;

			if (type === "groupStatusMessageV2") {
				content = msg[type].message;
				type = Object.keys(content)[0];
			} else {
				content = msg;
			}

			if (content?.[type]?.contextInfo) {
				delete content[type].contextInfo;
			}

			await sock.relayMessage(m.from, content, {});

			return "✅ Story successfully retrieved!";
		} catch (err) {
			throw new Error(err.message);
		}
	},
};
