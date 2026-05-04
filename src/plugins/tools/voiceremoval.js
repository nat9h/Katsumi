import { VocalRemover } from "#lib/scrapers/voiceremoval";
import uploader from "#lib/uploader";
import { to_audio } from "#utils/converter";

export default {
	name: "voiceremoval",
	description: "Separate vocal and instrumental from an audio file.",
	command: ["voiceremoval", "vr", "removevocal"],
	usage: "$prefix$command — reply/send an audio",
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

	execute: async (m) => {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q?.type || q?.mimetype || "";

		if (!/audio|ptt/i.test(mime)) {
			return m.reply("Please reply/send an audio file.");
		}

		const mediaBuffer = await q.download();

		if (!mediaBuffer) {
			throw new Error("Failed to download audio.");
		}

		const audioUrl = await uploader.providers.uguu.upload(mediaBuffer);

		const remover = new VocalRemover();
		const result = await remover.remove(audioUrl);

		if (!result?.instrumental || !result?.vocal) {
			throw new Error("Failed to get result paths.");
		}

		const outputs = [
			{
				title: "Instrumental",
				url: result.instrumental,
			},
			{
				title: "Vocal",
				url: result.vocal,
			},
		];

		for (const item of outputs) {
			const buffer = await downloadBuffer(item.url);
			const converted = await to_audio(buffer, "mp3");

			await m.reply({
				audio: Buffer.from(converted),
				mimetype: "audio/mpeg",
			});
		}
	},
};

async function downloadBuffer(url) {
	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(
			`Failed to download audio: ${response.status} ${response.statusText}`
		);
	}

	return Buffer.from(await response.arrayBuffer());
}
