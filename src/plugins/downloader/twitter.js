export default {
	name: "twitter",
	description: "Downloader Twitter / X.",
	command: ["x", "twt", "twitter"],
	usage: "$prefix$command https://x.com/lilskele/status/1377875528934334466",
	permissions: "all",
	hidden: false,
	failed: "Failed to execute %command: %error",
	wait: null,
	category: "downloader",
	cooldown: 5,
	limit: true,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	async execute(m, { api }) {
		const input =
			m.text && m.text.trim() !== ""
				? m.text
				: m.quoted && m.quoted.url
					? m.quoted.url
					: null;

		if (!input) {
			return m.reply("Input URL Twitter.");
		}

		const {
			data: { status, message, result },
		} = await api.Sayuran.get("/download/twitter", { url: input });

		if (!status) {
			return m.reply(message);
		}

		const key = result.type === "video" ? "video" : "image";

		for (const item of result.media) {
			const url = result.type === "video" ? item.url : item;

			await m.reply({
				[key]: { url },
			});
		}
	},
};
