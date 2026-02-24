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
		let user = m?.quoted?.sender || m.mentions[0];
		if (!user) {
			return m.reply("Reply or tag a user");
		}

		const participant = groupMetadata?.participants.find((p) =>
			[p.id, p.jid, p.phoneNumber].includes(user)
		);

		if (!participant) {
			return m.reply("User not found in group metadata.");
		}

		const userJid =
			participant.phoneNumber || participant.jid || participant.id;

		if (participant.admin) {
			return m.reply("You can't kick an admin");
		}

		await m.reply({
			text: `Kicked @${userJid.split("@")[0]} from ${groupMetadata.subject}`,
			mentions: [userJid],
		});

		await sock
			.groupParticipantsUpdate(m.from, [userJid], "remove")
			.catch((e) => {
				console.error("Kick Error:", e);
			});
	},
};
