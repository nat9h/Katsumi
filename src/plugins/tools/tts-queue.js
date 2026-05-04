import UmamusumeTTS from "#lib/scrapers/tts-queue";
import { to_audio } from "#utils/converter";

const LANG_LIST = ["日本語", "简体中文", "English", "Mix"];

export default {
	name: "tts",
	description: "Text-to-speech using Umamusume VITS voice models.",
	command: ["tts"],
	usage: "$prefix$command [-l lang] <text>",
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
					`Usage: ${m.prefix}tts [-l lang] <text>\n\n` +
					"Available languages:\n" +
					LANG_LIST.map((l, i) => `${i + 1}. ${l}`).join("\n") + "\n\n" +
					`Example: ${m.prefix + m.command} -l 4 hello world`
			);
		}

		let lang = "日本語";
		let textToSpeak = input;

		const flagRegex = /(?:-l|--lang)\s+([^\s]+)/i;
		const langMatch = input.match(flagRegex);

		if (langMatch) {
			const maybeLang = langMatch[1];
			const tts = new UmamusumeTTS();
			const picked = tts.pick(
				LANG_LIST,
				isNaN(maybeLang) ? maybeLang : parseInt(maybeLang)
			);
			
			if (picked) {
				lang = picked;
			} else {
				return m.reply(`Invalid language flag.\nAvailable languages:\n` + LANG_LIST.map((l, i) => `${i + 1}. ${l}`).join("\n"));
			}
			
			textToSpeak = input.replace(flagRegex, "").trim();
		}

		if (!textToSpeak) {
			return m.reply("Please provide the text to synthesize after the language flag.");
		}

		const tts = new UmamusumeTTS();
		const models = tts.getModels();

		const listMsg = models.map((v, i) => `*${i + 1}.* ${v}`).join("\n");

		const sent = await m.reply(
			"*TTS Voice Model*\n\n" +
				`Text: _${textToSpeak}_\n` +
				`Language: *${lang}*\n\n` +
				"_Reply with the *number* of the voice model you wish to use._\n\n" +
				"*Models:*\n" +
				listMsg
		);

		sock.tts[m.sender] = {
			text: textToSpeak,
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

		const response = await fetch(result.audio.url);
		const buffer = Buffer.from(await response.arrayBuffer());

		await m.reply({
			audio: await to_audio(buffer, "mp3"),
			mimetype: "audio/mpeg",
		});
	},
};