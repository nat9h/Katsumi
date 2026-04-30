import UmamusumeTTS from "#lib/scrapers/tts-queue";

const LANG_LIST = ["日本語", "简体中文", "English", "Mix"];

export default {
	name: "tts",
	description: "Text-to-speech using Umamusume VITS voice models.",
	command: ["tts"],
	usage: "$prefix$command [lang] <text>",
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

	execute: async (m, { sock }) => {
		if (!sock.tts) {
			sock.tts = {};
		}

		let input = m.text?.trim();
		if (!input) {
			return m.reply(
				"Please provide text to synthesize.\n" +
					`Usage: ${m.prefix}tts [lang] <text>\n\n` +
					"Available languages:\n" +
					LANG_LIST.map((l, i) => `${i + 1}. ${l}`).join("\n")
			);
		}

		let lang = "日本語";
		const langMatch = input.match(/^(\d+|[a-zA-Z\u3040-\u9fff]+)\s+(.+)/);
		if (langMatch) {
			const maybeLang = langMatch[1];
			const rest = langMatch[2];
			const tts = new UmamusumeTTS();
			const picked = tts.pick(
				LANG_LIST,
				isNaN(maybeLang) ? maybeLang : parseInt(maybeLang)
			);
			if (picked) {
				lang = picked;
				input = rest;
			}
		}

		const tts = new UmamusumeTTS();
		const models = tts.getModels();

		const listMsg = models.map((v, i) => `*${i + 1}.* ${v}`).join("\n");

		const sent = await m.reply(
			"*TTS Voice Model*\n\n" +
				`Text: _${input}_\n` +
				`Language: *${lang}*\n\n` +
				"_Reply with the *number* of the voice model you wish to use._\n\n" +
				"*Models:*\n" +
				listMsg
		);

		sock.tts[m.sender] = {
			text: input,
			lang,
			messageId: sent.key.id,
		};

		setTimeout(() => {
			if (sock.tts[m.sender]?.messageId === sent.key.id) {
				delete sock.tts[m.sender];
			}
		}, 90000);
	},

	after: async (m, { sock }) => {
		const session = sock.tts?.[m.sender];
		if (!session || !m.quoted || m.quoted.id !== session.messageId) {
			return;
		}

		const { text, lang } = session;
		const idx = parseInt(m.body.trim());
		const tts = new UmamusumeTTS();
		const models = tts.getModels();

		if (isNaN(idx) || idx < 1 || idx > models.length) {
			m.reply("Invalid number. Please run the command again.");
			delete sock.tts[m.sender];
			return;
		}

		const modelName = models[idx - 1];
		delete sock.tts[m.sender];

		await m.reply(
			"Generating TTS...\n\n" +
				`Model: *${modelName}*\n` +
				`Language: *${lang}*\n` +
				`Text: _${text}_\n` +
				"_Your audio will be sent shortly._"
		);

		const result = await tts.generate(text, {
			model: idx,
			lang,
			speed: 1,
			noise: false,
		});

		await m.reply({
			audio: { url: result.audio.url },
			mimetype: "audio/mpeg",
		});
	},
};
