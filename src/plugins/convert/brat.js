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
		const text = animated
			? input.replace(/\s-animated\s*$/i, "").trim()
			: input.trim();

		if (!text) {
			return m.reply("Please provide the text.");
		}

		const apiUrl = animated
			? `https://brat.caliphdev.com/api/brat/animate?text=${text}`
			: `https://brat.caliphdev.com/api/brat?text=${text}`;

		const response = await fetch(apiUrl);
		if (!response.ok) {
			throw new Error("Failed.");
		}
		const arrayBuffer = await response.arrayBuffer();
		const mediaBuffer = Buffer.from(arrayBuffer);

		const sticker = await Sticker.create(mediaBuffer, {
			packname: "@natsumiworld.",
			author: m.pushName,
			emojis: "🤣",
		});

		await m.reply({ sticker });
	},
};
