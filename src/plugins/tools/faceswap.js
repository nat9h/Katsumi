import { FaceSwap } from "#lib/scrapers/faceswap";
import uploader from "#lib/uploader";

export default {
	name: "faceswap",
	description: "Swap faces between two images using AI.",
	command: ["faceswap", "fs"],
	usage: "$prefix$command — reply an image (source) & attach another image (face), or send 2 URLs",
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "tools",
	cooldown: 30,
	limit: false,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m, { args }) => {
		const urlRegex = /(https?:\/\/[^\s]+?\.(?:png|jpe?g|webp))/gi;
		const urlsInArgs = [...args.join(" ").matchAll(urlRegex)].map(
			(x) => x[0]
		);

		let sourceUrl, faceUrl;

		// Mode 1: 2 URLs provided in args
		if (urlsInArgs.length >= 2) {
			[sourceUrl, faceUrl] = urlsInArgs;
		}
		// Mode 2: reply image = source, current message image = face
		else if (m.isQuoted && /image|webp|sticker/i.test(m.quoted?.type)) {
			const sourceBuf = await m.quoted.download();
			sourceUrl = await uploader.providers.uguu.upload(sourceBuf);

			const q = m;
			const mime = q?.type || "";
			if (!/image|webp|sticker/i.test(mime)) {
				return m.reply(
					"Please send a face image with the command while replying to the source image."
				);
			}
			const faceBuf = await q.download();
			faceUrl = await uploader.providers.uguu.upload(faceBuf);
		} else {
			return m.reply(
				"Usage:\n" +
					`1. Reply a source image & send a face image: ${m.prefix + m.command}\n` +
					`2. Provide 2 image URLs: ${m.prefix + m.command} <source_url> <face_url>`
			);
		}

		const swapper = new FaceSwap();
		const resultUrl = await swapper.run(sourceUrl, faceUrl);

		if (!resultUrl) {
			throw new Error("No result URL returned.");
		}

		const resBuf = Buffer.from(
			await fetch(resultUrl).then((r) => r.arrayBuffer())
		);

		await m.reply({
			image: resBuf,
			caption: "✅ Face swap done!",
		});
	},
};
