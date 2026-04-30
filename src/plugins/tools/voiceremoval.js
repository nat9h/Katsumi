import { VocalRemover } from "#lib/scrapers/voiceremoval";
import uploader from "#lib/uploader";

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
		const mime = q?.type || "";

		if (!/audio|ptt/i.test(mime)) {
			return m.reply("Please reply/send an audio file.");
		}

		// await m.reply("Processing audio, please wait...");

		const mediaBuffer = await q.download();
		const audioUrl = await uploader.providers.uguu.upload(mediaBuffer);

		const remover = new VocalRemover();
		const result = await remover.remove(audioUrl);

		if (!result.instrumental || !result.vocal) {
			throw new Error("Failed to get result paths.");
		}

		await m.reply({
			audio: { url: result.instrumental },
			mimetype: "audio/mpeg",
			caption: "🎵 Instrumental",
		});

		await m.reply({
			audio: { url: result.vocal },
			mimetype: "audio/mpeg",
			caption: "🎤 Vocal",
		});
	},
};
