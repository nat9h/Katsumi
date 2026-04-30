import { Outpainting } from "#lib/scrapers/outpainting";
import uploader from "#lib/uploader";

export default {
	name: "outpainting",
	description: "Expand image borders using AI outpainting.",
	command: ["outpaint", "expand"],
	usage: "$prefix$command — reply/send an image",
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "tools",
	cooldown: 15,
	limit: false,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m) => {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q?.type || "";

		if (!/image|webp|sticker/i.test(mime)) {
			return m.reply("Please reply/send an image.");
		}

		// await m.reply("Expanding image with AI, please wait...");

		const mediaBuffer = await q.download();
		const imageUrl = await uploader.providers.uguu.upload(mediaBuffer);

		const outpainter = new Outpainting();
		const result = await outpainter.process(imageUrl);

		await m.reply({
			image: result.buffer,
			caption: "✅ Outpainting done!",
		});
	},
};
