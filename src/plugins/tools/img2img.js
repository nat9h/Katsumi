import { Image2Image } from "#lib/scrapers/img2img";
import { randomUUID } from "node:crypto";

export default {
	name: "img2img",
	description: "Transform an image using AI with a text prompt.",
	command: ["img2img", "imagine"],
	usage: "$prefix$command <prompt> — reply/send an image",
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "tools",
	cooldown: 20,
	limit: false,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m, { args }) => {
		const prompt = args.join(" ").trim();
		if (!prompt) {
			return m.reply(
				"Please provide a prompt.\nUsage: " +
					`${m.prefix + m.command} <prompt>`
			);
		}

		const q = m.isQuoted ? m.quoted : m;
		const mime = q?.type || "";

		if (!/image|webp|sticker/i.test(mime)) {
			return m.reply("Please reply/send an image.");
		}

		const mediaBuffer = await q.download();
		const service = new Image2Image();

		const fileName = `${randomUUID()}.png`;
		const signedUrl = await service.getSignedUrl(fileName);
		await service.uploadToStorage(signedUrl, mediaBuffer);

		const publicUrl = `https://pub-0b8e9fd9929944af91cd191de51cb436.r2.dev/images/${fileName}`;

		let taskResult;
		let attempts = 0;
		while (true) {
			taskResult = await service.generateImage(publicUrl, prompt);
			if (taskResult.message?.includes("generated 3 images")) {
				if (++attempts >= 3) {
					throw new Error("Rate limit exceeded, try again later.");
				}
				service.refreshIdentity();
				continue;
			}
			break;
		}

		if (taskResult.code !== 200) {
			throw new Error(taskResult.message);
		}

		const finalImageUrl = await service.pollTaskStatus(
			taskResult.data.taskId
		);
		const resultBuffer = await service.getImageBuffer(finalImageUrl);

		await m.reply({
			image: resultBuffer,
			caption: `✅ Done!\n💭 Prompt: ${prompt}`,
		});
	},
};
