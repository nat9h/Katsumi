import { SettingsModel } from "../../lib/database/index.js";

export default {
	name: "mode",
	description: "Set bot operation mode: self / group / private / public",
	command: ["mode", "setting"],
	category: "owner",
	permissions: "owner",
	wait: null,
	owner: true,
	failed: "Failed to execute %command: %error",
	usage: "$prefix$command [self|group|private|public]",

	async execute(m, { args }) {
		const mode = args[0]?.toLowerCase();
		if (!["self", "group", "private", "public"].includes(mode)) {
			const current = await SettingsModel.getSettings();
			return m.reply(
				`Current Bot Mode:\n- Self: ${current.self}\n- Group Only: ${current.groupOnly}\n- Private Only: ${current.privateChatOnly}\n\nUsage:\n${this.usage.replace("$prefix", m.prefix).replace("$command", this.command[0])}\n\nExample:\n${m.prefix}${this.command[0]} group`
			);
		}

		let update = { self: false, groupOnly: false, privateChatOnly: false };
		if (mode !== "public") {
			update[
				mode === "group"
					? "groupOnly"
					: mode === "private"
						? "privateChatOnly"
						: "self"
			] = true;
		}

		await SettingsModel.updateSettings(update);
		m.reply(`✅ Bot mode has been updated to *${mode}*.`);
	},
};
