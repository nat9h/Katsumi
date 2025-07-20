import { downloadYt } from "#lib/yt-dlp";

export default {
	name: "play",
	description: "Youtube & Downloader (audio/video)",
	command: ["yt", "youtube", "play"],
	usage: "$prefix$command <query/link> [-video]",
	category: "downloader",
	permissions: "all",
	hidden: false,
	failed: "Failed to execute %command: %error",
	wait: null,
	cooldown: 5,
	limit: true,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m, { sock, api }) => {
		if (!sock.youtube) {
			sock.youtube = {};
		}

		let input =
			m.text && m.text.trim() !== ""
				? m.text
				: m.quoted && m.quoted.text
					? m.quoted.text
					: null;

		const videoFlag = /(?:^|\s)-(video)\b/i;
		let isVideo = videoFlag.test(input);
		if (isVideo) {
			input = input.replace(videoFlag, "").trim();
		}

		const urlMatch = input
			? input.match(
					/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/\S+/i
				)
			: null;
		const isLink = !!urlMatch;
		const url = urlMatch ? urlMatch[0] : null;

		if (!input) {
			return m.reply("Please provide a YouTube title, link, or query.");
		}

		if (isLink) {
			await m.reply(`⏳ Downloading ${isVideo ? "video" : "audio"}...`);
			const { buffer, fileName } = await downloadYt(url, {
				video: isVideo,
			});
			const mimetype = isVideo ? "video/mp4" : "audio/mpeg";
			if (buffer.length > 100 * 1024 * 1024) {
				await m.reply({
					document: buffer,
					mimetype,
					fileName,
					caption: fileName,
				});
			} else {
				if (isVideo) {
					await m.reply({
						video: buffer,
						mimetype,
						caption: fileName,
					});
				} else {
					await m.reply({
						audio: buffer,
						mimetype,
						caption: fileName,
					});
				}
			}
			return;
		}

		const {
			data: { status, message, result },
		} = await api.Sayuran.get("/search/yt", { q: input });

		if (!status) {
			return m.reply(message);
		}

		const listMsg = result
			.map(
				(v, i) =>
					`*${i + 1}.* *${v.title}*\n` +
					`Channel: ${v.author}\n` +
					`Duration: ${v.duration} \n` +
					`Views: ${v.views}\n` +
					`URL:\n${v.url}\n`
			)
			.join("\n");

		const sent = await m.reply(
			"*YouTube Search*\n\n" +
				`Query: _${input}_\n` +
				`Format: *${isVideo ? "Video" : "Audio"}*\n\n` +
				"_Please reply with the *number* of you wish to download._\n\n" +
				"*List:*\n" +
				`${listMsg}`.trim()
		);
		sock.youtube[m.sender] = {
			results: result,
			isVideo,
			messageId: sent.key.id,
		};

		setTimeout(() => {
			if (sock.youtube[m.sender]?.messageId === sent.key.id) {
				delete sock.youtube[m.sender];
			}
		}, 90000);
	},

	after: async (m, { sock }) => {
		const session = sock.youtube?.[m.sender];
		if (!session || !m.quoted || m.quoted.id !== session.messageId) {
			return;
		}

		const { results, isVideo } = session;
		const idx = parseInt(m.body.trim());
		if (isNaN(idx) || idx < 1 || idx > results.length) {
			m.reply(
				"Invalid number. Please run the command again to start a new search."
			);
			delete sock.youtube[m.sender];
			return;
		}

		const chosen = results[idx - 1];

		await m.reply(
			"Preparing your download...\n\n" +
				`Title: *${chosen.title}*\n` +
				`Channel: *${chosen.author}*\n` +
				`Duration: *${chosen.duration}*\n` +
				`Format: *${isVideo ? "Video" : "Audio"}*\n\n` +
				"_Your file will be sent shortly._".trim()
		);

		const { buffer, fileName } = await downloadYt(chosen.url, {
			video: isVideo,
			title: chosen.title,
		});
		const mimetype = isVideo ? "video/mp4" : "audio/mpeg";
		if (buffer.length > 100 * 1024 * 1024) {
			await m.reply({
				document: buffer,
				mimetype,
				fileName,
				caption: fileName,
			});
		} else {
			if (isVideo) {
				await m.reply({ video: buffer, mimetype });
			} else {
				await m.reply({ audio: buffer, mimetype });
			}
		}
		delete sock.youtube[m.sender];
	},
};
