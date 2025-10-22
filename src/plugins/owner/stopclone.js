import { useMongoDbAuthState } from "#lib/auth/mongodb";
import { CloneSessionModel } from "#lib/database/models/cloneSessions";

export default {
	name: "stopclone",
	description: "Stop a specific CloneBot session.",
	command: ["stopclone", "stopbot"],
	category: "owner",
	owner: true,
	wait: null,
	react: true,
	hidden: true,
	usage: "$prefix$command <phone/session_id>",

	/**
	 * @param {import("#lib/serialize.js").SerializedMessage} m
	 * @param {string[]} args
	 */
	execute: async (m, { args }) => {
		const arg = (args[0] || "").replace(/\D/g, "");

		if (!arg) {
			return m.reply(
				"⚠️ Please enter the *phone number* or *session ID* you want to stop.\n\n" +
					"Example:\n" +
					`*${m.prefix + m.command}* 628xxxxxxxxxx\n` +
					`*${m.prefix + m.command}* <session_id>`
			);
		}

		const sessions = await CloneSessionModel.list();
		const found = sessions.find(
			(s) => s._id === arg || s.phone.endsWith(arg) || s.phone === arg
		);

		if (!found) {
			return m.reply(
				"🚫 Session not found. Please check the number or session ID."
			);
		}

		const mongoUrl = process.env.MONGO_URI;
		const { removeCreds } = await useMongoDbAuthState(mongoUrl, {
			session: found._id,
		});

		await removeCreds();
		await CloneSessionModel.remove(found._id);

		return m.reply(
			[
				"🛑 *CloneBot Session Stopped & Deleted!*",
				`• *Session ID:* ${found._id}`,
				`• *Phone:* +${found.phone}`,
				"",
				"_The session has been successfully terminated and removed from the database._",
			].join("\n")
		);
	},
};
