import Sticker from "#lib/sticker";

export default {
	name: "brat",
	description: "Create a sticker brat.",
	command: ["brat"],
	usage: "$prefix$command <text> (-animated for text animated).",
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

	async execute(m) {
		const input =
			m.text && m.text.trim() !== ""
				? m.text
				: m.quoted && m.quoted.text
					? m.quoted.text
					: null;

		if (!input) {
			return m.reply("Input text.");
		}

		const animated = /\s-animated\s*$/i.test(input);
		const text = input.replace(/\s-animated\s*$/i, "").trim();
		if (!text) {
			return m.reply("Please provide the text.");
		}

		const baseUrl = "https://inusoft-brat.hf.space/api/";
		const url = `${baseUrl}${animated ? "bratvid" : "brat"}?text=${encodeURIComponent(text)}`;

		const res = await fetch(url);
		if (!res.ok) {
			throw new Error("Failed to fetch.");
		}

		const { URL } = await res.json();
		const buffer = Buffer.from(
			await (await fetch(URL.trim())).arrayBuffer()
		);

		const sticker = await Sticker.create(buffer, {
			packname: "@natsumiworld.",
			author: m.pushName,
			emojis: "🤣",
		});

		await m.reply({ sticker });
	},
};
