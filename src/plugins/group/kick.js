export default {
	name: "kick",
	description: "Kick member from group.",
	command: ["kick", "out"],
	permissions: "admin",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "group",
	cooldown: 5,
	limit: false,
	usage: "$prefix$command reply, tag or number user.",
	react: true,
	botAdmin: true,
	group: true,
	private: false,
	owner: false,

	/**
	 * @param {import('baileys').WASocket} sock - The Baileys socket object.
	 * @param {object} m - The serialized message object.
	 */
	async execute(m, { sock, groupMetadata }) {
		const user = m?.quoted?.sender || m.mentions[0];
		if (!user) {
			return m.reply("Reply or tag a user");
		}

		const groupAdmins = groupMetadata?.participants
			.filter((participant) => participant.admin)
			.map((participant) => participant.jid);

		if (groupAdmins.includes(user)) {
			return m.reply("You can't kick an admin");
		}

		await m.reply({
			text: `Kicked @${user.replace(/[^0-9]/g, "")} from ${groupMetadata.subject}`,
			mentions: [user],
		});

		await sock
			.groupParticipantsUpdate(m.from, [user], "remove")
			.catch(() => {});
	},
};
