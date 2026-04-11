import RemoveBG from "#lib/scrapers/removeBG";

export default {
	name: "removebg",
	description: "Remove a background.",
	command: ["removebg", "rbg"],
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "tools",
	cooldown: 5,
	limit: true,
	usage: "$prefix$command <reply/send image>",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m) => {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q.type || q.mime || "";

		if (!/image|document/i.test(mime)) {
			return m.reply("Please reply/send an image with the command.");
		}

		const media = await q.download();
		const buffer = Buffer.isBuffer(media) ? media : Buffer.from(media);

		const remover = new RemoveBG();
		const result = await remover.fromBuffer(buffer, "removebg.jpg");

		return m.reply({
			image: result,
			mimetype: "image/png",
		});
	},
};
