import {
	audioEffects,
	getAudioEffectCommands,
	to_audio,
} from "#utils/converter";

export default {
	name: "audiofx",
	description: "Apply audio effect",
	command: ["audiofx"],
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "convert",
	cooldown: 5,
	limit: false,
	usage: "$prefix$command reply media",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m) => {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q.type || "";
		if (!/audio|video/i.test(mime)) {
			return m.reply(
				"Please reply/send audio or video with the command."
			);
		}

		let input = m.text?.trim();
		const available = getAudioEffectCommands();

		const numberedList = (arr) =>
			arr.map((e, i) => `${i + 1}. ${e}`).join("\n");

		if (!input) {
			const list = numberedList(available);
			return m.reply(
				"Input effect name or number.\n" +
					"Example:\n" +
					`${m.prefix + m.command} nightcore\n` +
					`${m.prefix + m.command} 3\n\n` +
					`List effects:\n${list}`
			);
		}

		let key = input.toLowerCase();

		if (/^\d+$/.test(key)) {
			const idx = Number(key) - 1;
			if (idx >= 0 && idx < available.length) {
				key = available[idx];
				input = key;
			}
		}

		if (!available.includes(key)) {
			const list = numberedList(available);
			return m.reply(
				`Effect *${input}* isn't found.\n\n` +
					`*List effects*:\n${list}\n\n` +
					`*Example*: ${m.prefix + m.command} nightcore`
			);
		}

		const media = await q.download();
		const inBuf = Buffer.isBuffer(media)
			? media
			: Buffer.from(media, "utf-8");
		const outBuf = await audioEffects(inBuf, key);
		const convert = await to_audio(outBuf, "mp3");

		return m.reply({ audio: Buffer.from(convert), mimetype: "audio/mpeg" });
	},
};
