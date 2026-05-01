import { Upscaler } from "#lib/scrapers/upscale";
import uploader from "#lib/uploader";

export default {
	name: "upscale",
	description: "Upscale an image using AI.",
	command: ["upscale", "ups", "hd"],
	usage: "$prefix$command <2|4> — reply/send an image",
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "tools",
	cooldown: 10,
	limit: false,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m, { args }) => {
		const scaleRadio = [2, 4].includes(parseInt(args[0]))
			? parseInt(args[0])
			: 2;

		const q = m.isQuoted ? m.quoted : m;
		const mime = q?.type || "";

		if (!/image|webp|sticker/i.test(mime)) {
			return m.reply(
				"Please reply/send an image.\nUsage: " +
					`${m.prefix}upscale <2|4>`
			);
		}

		// await m.reply(`Upscaling at ${scaleRadio}x, please wait...`);

		const mediaBuffer = await q.download();
		const imageUrl = await uploader.providers.uguu.upload(mediaBuffer);

		const upscaler = new Upscaler({
			scaleRadio,
			pollIntervalMs: 3000,
			timeoutMs: 120000,
			debug: false,
		});

		const result = await upscaler.upscaleFromUrl(imageUrl, scaleRadio);

		await m.reply({
			image: result.buffer,
			caption: `✅ Upscale done!\n📐 Scale: ${scaleRadio}x`,
		});
	},
};
