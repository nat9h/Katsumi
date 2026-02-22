import Sticker from "#lib/sticker";

export default {
	name: "brat",
	description: "Create a brat sticker.",
	command: ["brat"],
	usage: "$prefix$command <text>",
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "convert",
	cooldown: 5,
	limit: false,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m) => {
		const input =
			m.text && m.text.trim() !== ""
				? m.text
				: m.quoted && m.quoted.text
					? m.quoted.text
					: null;

		if (!input) {
			return m.reply("Input text.");
		}

		const text = input.trim();
		if (!text) {
			return m.reply("Please provide the text.");
		}

		const url = `https://shinana-brat.hf.space/?text=${encodeURIComponent(text)}`;

		const res = await fetch(url);
		if (!res.ok) {
			throw new Error("Failed to fetch brat image.");
		}

		const buffer = Buffer.from(await res.arrayBuffer());

		const sticker = await Sticker.create(buffer, {
			packname: "@natsumiworld.",
			author: m.pushName,
			emojis: "🤣",
		});

		await m.reply({ sticker });
	},
};
