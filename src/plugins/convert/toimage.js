import { webpToImage } from "#utils/converter";

export default {
	name: "toimage",
	description: "Convert sticker to image.",
	command: ["toimg", "toimage"],
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "convert",
	cooldown: 5,
	limit: false,
	usage: "$prefix$command reply sticker",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	/**
	 * @param {import('baileys').WASocket} sock - The Baileys socket object.
	 * @param {object} m - The serialized message object.
	 */
	execute: async (m) => {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q.type || "";
		if (!/webp|sticker|document/i.test(mime)) {
			return m.reply("Please reply/send a sticker with the command.");
		}
		const media = await q.download();
		const buffer = Buffer.isBuffer(media)
			? media
			: Buffer.from(media, "utf-8");
		const convert = await webpToImage(buffer);
		await m.reply({ image: convert });
	},
};
