import { GroupModel, UserModel } from "../../lib/database/index.js";

export default {
	name: "ban",
	description: "Ban or unban a user or group.",
	command: ["ban", "banchat"],
	category: "owner",
	permissions: "owner",
	owner: true,
	react: true,
	wait: null,
	failed: "Failed to execute %command: %error",
	usage: "$prefix$command reply or tag user.",
	cooldown: 5,
	limit: false,
	botAdmin: false,
	group: false,
	private: false,

	execute: async (m, { groupMetadata }) => {
		if (m?.quoted?.sender || m.mentions[0] || m.text) {
			const _user =
				(m?.quoted?.sender || m.mentions[0] || m.text).replace(
					/[^0-9]/g,
					""
				) + "@s.whatsapp.net";

			const user = await UserModel.getUser(_user);
			await UserModel.setName(_user, m.pushName);

			const newBanned = !user.banned;
			await UserModel.setBanned(_user, newBanned);

			await m.reply(
				`${newBanned ? "Banned" : "Unbanned"} @${_user.replace(/[^0-9]/g, "")}`
			);

			return;
		}

		const group = await GroupModel.getGroup(m.from);
		await GroupModel.setName(m.from, groupMetadata.subject);

		const newBanned = !group.banned;
		await GroupModel.setBanned(m.from, newBanned);

		await m.reply(
			`Banchat is now ${newBanned ? "enabled" : "disabled"} for ${groupMetadata.subject}`
		);

		return;
	},
};
