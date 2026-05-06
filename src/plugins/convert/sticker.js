import { getEmojiRegex, isUrlMedia } from "#lib/functions";
import Sticker from "#lib/sticker";
import uploader from "#lib/uploader";

export default {
	name: "sticker",
	description: "Create a sticker.",
	command: ["sticker", "stiker", "s"],
	usage: "$prefix$command reply/send image/video/url, or leave empty for random sticker.",
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "convert",
	cooldown: 5,
	limit: false,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m, { args, sock }) => {
		let input = args.join(" ").trim();
		let q = m.isQuoted ? m.quoted : m;
		let mime = q && q.type ? q.type : "";
		let urlMedia = null;
		let mediaBuffer = null;
		let isMedia = false;

		if (m.mentions && m.mentions[0]) {
			const pfpUrl = await sock
				.profilePictureUrl(m.mentions[0], "image")
				.catch(
					() =>
						"https://i.pinimg.com/736x/f1/26/e3/f126e305c9a2ba39aba2b882584b2afd.jpg"
				);
			mediaBuffer = Buffer.from(
				await fetch(pfpUrl).then((res) => res.arrayBuffer())
			);
			const sticker = await Sticker.create(mediaBuffer, {
				packname: "@natsumiworld.",
				author: m.pushName,
				emojis: "🤣",
			});
			return await m.reply({ sticker });
		}

		let isQc = false;
		if (input.includes("-qc")) {
			isQc = true;
			input = input.replace("-qc", "").trim();
		}

		if (m.isQuoted && m.quoted) {
			if (/image|video|sticker|webp|document|audio/.test(mime)) {
				await new Promise((res) => setTimeout(res, 500));
				mediaBuffer = await q.download();
				isMedia = true;
			}
		}

		const urlMatch = isUrlMedia(input);
		if (urlMatch && !isMedia) {
			urlMedia = urlMatch[0];
			mediaBuffer = Buffer.from(
				await fetch(urlMedia).then((res) => res.arrayBuffer())
			);
			input = input.replace(urlMedia, "").trim();
			isMedia = true;
		} else if (
			/sticker|webp|image|video|webm|document/g.test(mime) &&
			!isMedia
		) {
			mediaBuffer = await q.download();
			isMedia = true;
		}

		let isAutoQc = m.isQuoted && q.text && !isMedia && !input;

		if (isQc || isAutoQc) {
			let _qc = input || (m.isQuoted ? q.text || q.caption || "" : "");

			if (!_qc && !isMedia) {
				return m.reply(
					"What's the text or media? Provide text or reply media to create a QC."
				);
			}

			let _target = m.isQuoted ? q.sender : m.sender;
			const url = await sock
				.profilePictureUrl(_target, "image")
				.catch(
					() =>
						"https://i.pinimg.com/736x/f1/26/e3/f126e305c9a2ba39aba2b882584b2afd.jpg"
				);
			const username = await sock.getName(_target);

			const { text: _qcText, entities: entity } = parseMarkdown(
				_qc,
				markup
			);

			let replyMedia = {};
			if (isMedia && mediaBuffer) {
				try {
					const link =
						await uploader.providers.uguu.upload(mediaBuffer);
					replyMedia = {
						media: {
							url: link,
						},
					};
				} catch {
					replyMedia = {
						media: {
							url: `data:${mime || "image/jpeg"};base64,${mediaBuffer.toString("base64")}`,
						},
					};
				}
			} else if (urlMedia) {
				replyMedia = {
					media: {
						url: urlMedia,
					},
				};
			}

			let payload_msg = {
				avatar: true,
				from: { id: 8, name: username, photo: { url } },
				text: _qcText,
				entities: entity,
				...replyMedia,
				replyMessage: {},
			};

			const request = {
				type: "image",
				format: "png",
				backgroundColor: m.isGroup ? "#FFFFFF" : "#FFFFFF",
				width: 512,
				height: 786,
				scale: 2,
				messages: [payload_msg],
			};

			const response = await fetch("https://qc.chitoge.win/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
			});

			if (!response.ok) {
				return m.reply("Failed to generate sticker.");
			}

			const data = await response.json();
			const quotly = Buffer.from(data.result.image, "base64");
			const sticker = await Sticker.create(quotly, {
				packname: "@natsumiworld.",
				author: m.pushName,
				emojis: "🤣",
			});
			return await m.reply({ sticker });
		}

		if (!isMedia && input) {
			const emojiRegex = getEmojiRegex();
			const emojis = input.match(emojiRegex);

			if (emojis && emojis.length === 1 && emojis[0] === input.trim()) {
				const emojiUrl = getAnimatedEmojiUrl(emojis[0]);
				const buffer = Buffer.from(
					await fetch(emojiUrl).then((res) => res.arrayBuffer())
				);
				const sticker = await Sticker.create(buffer, {
					packname: "@natsumiworld.",
					author: m.pushName,
					emojis: emojis[0],
				});
				return await m.reply({ sticker });
			}

			if (
				emojis &&
				emojis.length === 2 &&
				emojis.join("") === input.trim()
			) {
				const [emoji1, emoji2] = emojis;
				const url = `https://tenor.googleapis.com/v2/featured?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${emoji1}_${emoji2}`;
				const response = await fetch(url);
				const data = await response.json();

				if (!data.results || data.results.length === 0) {
					return m.reply("No emoji mix result found.");
				}

				const mediaUrl =
					data.results[0].media_formats.png_transparent.url;
				const buffer = Buffer.from(
					await fetch(mediaUrl).then((res) => res.arrayBuffer())
				);
				const sticker = await Sticker.create(buffer, {
					packname: "@natsumiworld.",
					author: m.pushName,
					emojis: emojis.join(""),
				});
				return await m.reply({ sticker });
			}
		}

		let teks1 = "_",
			teks2 = "_";
		if (input.length > 0) {
			if (input.includes("|")) {
				[teks1, teks2] = input.split("|").map((t) => t.trim() || "_");
			} else {
				teks1 = input;
			}
		}

		if (input.length > 0 && isMedia) {
			const url = await uploader.providers.uguu.upload(mediaBuffer);
			const res = await fetch(
				`https://api.memegen.link/images/custom/${encodeURIComponent(teks1)}/${encodeURIComponent(teks2)}.png?background=${url}`,
				{ responseType: "arraybuffer" }
			);
			const memeImage = await res.arrayBuffer();
			const sticker = await Sticker.create(Buffer.from(memeImage), {
				packname: "@natsumiworld.",
				author: m.pushName,
				emojis: "🤣",
			});
			return await m.reply({ sticker });
		}

		if (isMedia && input.length === 0) {
			const sticker = await Sticker.create(mediaBuffer, {
				packname: "@natsumiworld.",
				author: m.pushName,
				emojis: "🤣",
			});
			return await m.reply({ sticker });
		}

		if (!isMedia && input.length === 0) {
			const maxRetries = 5;
			let attempts = 0;
			let buffer = null;
			while (attempts < maxRetries) {
				try {
					const response = await fetch("https://sticker.rmdni.id");
					const arrayBuffer = await response.arrayBuffer();
					buffer = Buffer.from(arrayBuffer);
					break;
				} catch {
					attempts++;
					if (attempts >= maxRetries) {
						return m.reply(
							"Failed to fetch random sticker after multiple attempts."
						);
					}
				}
			}
			const sticker = await Sticker.create(buffer, {
				packname: "@natsumiworld.",
				author: m.pushName,
				emojis: "🤣",
			});
			return await m.reply({ sticker });
		}
	},
};

const getAnimatedEmojiUrl = (emoji) => {
	const codepoints = [...emoji]
		.map((char) => char.codePointAt(0).toString(16))
		.join("-");
	return `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoints}/512.webp`;
};

const parseMarkdown = (text, markups) => {
	if (!text) {
		return { text: "", entities: [] };
	}
	let entities = [];
	let _txt = text;

	const sortedMarkups = [...markups].sort(
		(a, b) => b.marker.length - a.marker.length
	);

	for (const { marker, type } of sortedMarkups) {
		const escapeMark = marker.replace(
			/[-[\]{}()*+?.,\\^$|#\s]/g,
			"\\$&"
		);
		const regex = new RegExp(`${escapeMark}(.+?)${escapeMark}`, "g");

		let match;
		while ((match = regex.exec(_txt)) !== null) {
			const innerText = match[1];
			const offset = match.index;
			const length = innerText.length;

			entities.push({ type, offset, length });

			_txt =
				_txt.substring(0, offset) +
				innerText +
				_txt.substring(offset + match[0].length);
			regex.lastIndex = offset + length;
		}
	}
	return { text: _txt, entities };
};

const markup = [
	{
		marker: "```",
		type: "pre",
		raw: true,
	},
	{
		marker: "||",
		type: "spoiler",
		raw: false,
	},
	{
		marker: "~~",
		type: "strikethrough",
		raw: false,
	},
	{
		marker: "*",
		type: "bold",
		raw: false,
	},
	{
		marker: "_",
		type: "italic",
		raw: false,
	},
	{
		marker: "~",
		type: "strikethrough",
		raw: false,
	},
	{
		marker: "`",
		type: "code",
		raw: true,
	},
];
