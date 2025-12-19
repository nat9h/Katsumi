export default {
	name: "screenshot",
	description: "Screenshot a website.",
	command: ["ss", "ssweb"],
	usage: "$prefix$command https://google.com",
	permissions: "all",
	hidden: false,
	failed: "Failed to execute %command: %error",
	wait: null,
	category: "tools",
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
			return m.reply("Input URL.");
		}

		let url = input.trim();
		if (!/^https?:\/\//i.test(url)) {
			url = "https://" + url;
		}

		const {
			data: { status, message, result },
		} = await api.Sayuran.get("/tools/ss", { url });

		if (!status) {
			return m.reply(message);
		}

		await m.reply(result.url);
	},
};
