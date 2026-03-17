export default {
	name: "help",
	description: "Show help information",
	command: ["help", "menu"],
	permissions: "all",
	hidden: false,
	failed: "Failed to show %command: %error",
	category: "info",
	cooldown: 5,
	usage: "$prefix$command [command|category]",
	react: true,
	wait: null,

	execute: async (m, { plugins, isOwner, sock }) => {
		const categories = new Map();

		const collator = new Intl.Collator("id", {
			sensitivity: "base",
			numeric: true,
		});

		for (const plugin of plugins) {
			if (plugin.hidden || (plugin.owner && !isOwner)) {
				continue;
			}
			const key = (plugin.category || "general").toLowerCase().trim();

			if (!categories.has(key)) {
				categories.set(key, []);
			}
			categories.get(key).push(plugin);
		}

		let response = "";

		if (m.args.length === 0) {
			response += `Hello, @${m.sender.replace(/[^0-9]/g, "")}!\n\n`;
			response += "_𓆩♡𓆪 *Available Commands:*_\n";

			const sortedCategories = [...categories.entries()].sort(
				([a], [b]) => collator.compare(a, b)
			);

			for (const [category, cmds] of sortedCategories) {
				const categoryName =
					category.charAt(0).toUpperCase() + category.slice(1);

				response += `\nꕥ ${categoryName}\n`;

				const sortedCmds = [...cmds].sort((a, b) =>
					collator.compare(
						a?.command?.[0] || "",
						b?.command?.[0] || ""
					)
				);

				for (const cmd of sortedCmds) {
					const aliases =
						cmd.command.length > 1
							? ` _(alias: ${cmd.command.slice(1).join(", ")})_`
							: "";
					response += `•  *${m.prefix}${cmd.command[0]}*${aliases}\n`;
				}
			}

			response += `\nꕥ _Tip: \`${m.prefix}help [command or category]\` for details._`;
		} else {
			const query = m.args[0].toLowerCase();

			const plugin = plugins.find((p) =>
				p.command.some((cmd) => cmd.toLowerCase() === query)
			);

			if (plugin && !plugin.hidden && (!plugin.owner || isOwner)) {
				response += `ꕥ Command: *${plugin.name}*\n\n`;
				response += `• *Description:* ${plugin.description}\n`;
				response += `• *Aliases:*  \`${plugin.command.join(", ")}\`\n`;
				response += `• *Category:* ${
					plugin.category.charAt(0).toUpperCase() +
					plugin.category.slice(1)
				}\n`;

				if (plugin.usage) {
					const usageLines = (
						Array.isArray(plugin.usage)
							? plugin.usage
							: String(plugin.usage).split("\n")
					)
						.flatMap((line) => String(line).split("\n"))
						.map((line) => line.trim())
						.filter(Boolean)
						.map((line) =>
							line
								.replace(/\$prefix/g, m.prefix)
								.replace(/\$command/g, plugin.command[0])
						);

					response += `• *Usage:*\n${usageLines
						.map((line) => `  \`${line}\``)
						.join("\n")}\n`;
				}
				if (plugin.cooldown > 0) {
					response += `• *Cooldown:* ${plugin.cooldown}s\n`;
				}
				if (plugin.limit) {
					response += `• *Limit:* ${plugin.limit}\n`;
				}
				if (plugin.dailyLimit > 0) {
					response += `• *Daily Limit:* ${plugin.dailyLimit}\n`;
				}
				if (plugin.permissions !== "all") {
					response += `• *Required Role:* ${plugin.permissions}\n`;
				}
				if (plugin.group) {
					response += "• *Group Only*\n";
				}
				if (plugin.private) {
					response += "• *Private Chat Only*\n";
				}
				if (plugin.owner) {
					response += "• *Owner Only*\n";
				}
				if (plugin.botAdmin) {
					response += "• *Bot Admin Needed*\n";
				}
				response += "\n✨ _Respect cooldown & enjoy!_";
			} else if (categories.has(query)) {
				const categoryName =
					query.charAt(0).toUpperCase() + query.slice(1);

				const categoryPlugins = [...categories.get(query)].sort(
					(a, b) =>
						collator.compare(
							a?.command?.[0] || "",
							b?.command?.[0] || ""
						)
				);

				response += `ꕥ *${categoryName} Commands:*\n\n`;
				for (const cmd of categoryPlugins) {
					const aliases =
						cmd.command.length > 1
							? ` _(alias: ${cmd.command.slice(1).join(", ")})_`
							: "";
					response += `•  *${m.prefix}${cmd.command[0]}*${aliases}: ${cmd.description}\n`;
				}
				response += `\n_Explore more: \`${m.prefix}help <command>\`_`;
			} else {
				response = `*Not Found*\n│\n🙁 Sorry, *${query}* not found.\n\n_Type:_ \`${m.prefix}help\` _to see all commands._\n`;
			}
		}

		const pp = "https://telegra.ph/file/7c3ed11c5dd1e2a64bd02.jpg";
		const thumbnailUrl = await sock
			.profilePictureUrl(m.sender, "image")
			.catch(() => pp);

		await m.reply({
			text: response.trim(),
			contextInfo: {
				externalAdReply: {
					title: "",
					body: "@natsumiworld",
					renderLargerThumbnail: true,
					sourceUrl:
						"https://whatsapp.com/channel/0029Va8b0s8G3R3jDBfpja0a",
					mediaType: 1,
					thumbnailUrl,
				},
				mentionedJid: [m.sender],
			},
		});
	},
};
