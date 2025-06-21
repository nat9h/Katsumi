export default {
	name: "clearchat",
	description: "Clear all chat history for this chat.",
	command: ["clearchat"],
	permissions: "owner",
	hidden: false,
	failed: "Failed to clear %command: %error",
	wait: null,
	category: "owner",
	cooldown: 5,
	limit: false,
	usage: "$prefix$command",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: true,

	/**
	 * @param {import('baileys').WASocket} sock - The Baileys socket object.
	 * @param {object} m - The serialized message object.
	 */
	execute: async (m, { sock }) => {
		await sock.chatModify(
			{
				delete: true,
				lastMessages: [
					{
						key: m.key,
						messageTimestamp: m.messageTimestamp,
					},
				],
			},
			m.from
		);
	},
};
