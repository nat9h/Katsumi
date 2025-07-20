import { CloneSessionModel } from "#lib/database/models/cloneSessions";

export default {
	name: "listclone",
	description: "List all active CloneBot sessions.",
	command: ["listclone", "listbot"],
	category: "owner",
	owner: true,
	react: true,
	hidden: true,
	wait: null,

	/**
	 * @param {import("../../lib/serialize.js").SerializedMessage} m
	 */
	execute: async (m) => {
		const sessions = await CloneSessionModel.list();

		if (!sessions.length) {
			return m.reply("🚫 No active clone bot sessions found.");
		}

		const text = sessions
			.map(
				(session, index) =>
					`• #${index + 1} +${session.phone} (Session: ${session._id}) [${session.connected ? "ONLINE" : "OFFLINE"}]`
			)
			.join("\n");

		return m.reply(["🔎 *Active CloneBot Sessions:*", "", text].join("\n"));
	},
};
