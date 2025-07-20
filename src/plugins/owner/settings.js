import { SettingsModel } from "#lib/database/index";

export default {
	name: "setting",
	description: "Enable/disable periodic bot features.",
	command: ["setting"],
	category: "owner",
	owner: true,
	react: true,
	wait: null,
	hidden: true,
	usage: "$prefix$command <feature> <on|off>",

	async execute(m, { args, plugins }) {
		const [rawFeature, rawValue] = args;
		const feature = (rawFeature || "").toLowerCase();
		const value = (rawValue || "").toLowerCase();

		const periodicFeatures = getPeriodicFeatures(plugins);

		const current = await SettingsModel.getSettings();
		const featureList = periodicFeatures
			.map((f) => `- *${f}*: ${current[f] ? "ON" : "OFF"}`)
			.join("\n");

		const helpMsg =
			`*Bot Feature Settings*\n\n${featureList}\n\n` +
			`Usage: ${this.usage.replace("$prefix", m.prefix).replace("$command", this.command[0])}\n` +
			`Example: ${m.prefix}${this.command[0]} autobackup off`;

		if (
			!feature ||
			!value ||
			!["on", "off"].includes(value) ||
			!periodicFeatures.includes(feature)
		) {
			return m.reply(helpMsg.trim());
		}

		const update = {};
		update[feature] = value === "on";
		await SettingsModel.updateSettings(update);
		m.reply(`Feature *${feature}* is now *${value.toUpperCase()}*`);
	},
};

/**
 * Get all periodic plugin features (by name).
 * @param {Array} plugins - Array of all plugins
 * @returns {Array<string>}
 */
function getPeriodicFeatures(plugins) {
	return plugins
		.filter(
			(p) =>
				p &&
				p.periodic &&
				typeof p.periodic.run === "function" &&
				typeof p.name === "string"
		)
		.map((p) => p.name.toLowerCase());
}
