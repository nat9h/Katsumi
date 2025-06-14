import { existsSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export default {
	name: "deletefile",
	description: "Delete file.",
	command: ["df", "deletefile"],
	permissions: "owner",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "owner",
	cooldown: 5,
	limit: false,
	usage: "$prefix$command <name_file>",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: true,

	/**
	 * @param {import('baileys').WASocket} sock - The Baileys socket object.
	 * @param {object} m - The serialized message object.
	 */
	execute: async (m) => {
		if (!m.text) {
			return m.reply(
				`Where is the path?\n${m.prefix + m.command} src/plugin/*/icikiwir.js`
			);
		}
		const filePath = join(process.cwd(), m.text);
		if (!existsSync(filePath)) {
			return m.reply(
				"Sorry, the file or folder in question was not found."
			);
		}
		if (statSync(filePath).isDirectory()) {
			rmdirSync(filePath, { recursive: true });
		} else {
			unlinkSync(filePath);
		}

		m.reply(`Successfully delete ${m.text}`);
	},
};
