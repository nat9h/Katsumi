import uploader from "../../lib/uploader.js";

export default {
	name: "uploader",
	description: "Upload a File.",
	command: ["upload", "tourl"],
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "tools",
	cooldown: 5,
	limit: true,
	usage: "$prefix$command <media>",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m) => {
		const providers = Object.values(uploader.providers);

		const showProviderList = () => {
			let providerList = "List:\n";
			providers.forEach((provider, index) => {
				providerList += `${index + 1}. ${provider.constructor.name}\n`;
			});
			return providerList.trim();
		};

		const q = m.isQuoted ? m.quoted : m;
		const mime = q.type || "";
		if (!/webp|image|video|audio|webm|document|sticker/g.test(mime)) {
			return m.reply(
				"Please reply/send a media with the command.\n" +
					showProviderList()
			);
		}
		const media = await q.download();
		const buffer = Buffer.isBuffer(media)
			? media
			: Buffer.from(media, "utf-8");

		if (!m.args.length) {
			return m.reply(showProviderList());
		}

		const index = parseInt(m.args[0]) - 1;
		if (isNaN(index) || index < 0 || index >= providers.length) {
			return m.reply(
				"Invalid, choose a provider.\n\n" + showProviderList()
			);
		}

		m.reply({ text: `${await providers[index].upload(buffer)}`.trim() });
	},
};
