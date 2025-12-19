import { fileTypeFromBuffer } from "file-type";

export default {
	name: "threads",
	description: "Downloader Threads.",
	command: ["threads"],
	usage: "$prefix$command https://www.threads.com/@jesus_faithful/post/DSRxu6xicCb",
	permissions: "all",
	hidden: false,
	failed: "Failed to execute %command: %error",
	wait: null,
	category: "downloader",
	cooldown: 5,
	limit: true,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	async execute(m, { api }) {
		const input =
			m.text && m.text.trim() !== ""
				? m.text
				: m.quoted && m.quoted.url
					? m.quoted.url
					: null;

		if (!input) {
			return m.reply("Input URL Threads.");
		}

		const {
			data: { status, message, result },
		} = await api.Sayuran.get("/download/threads", { url: input });

		if (!status) {
			return m.reply(message);
		}

		const download = async (url) => {
			const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
			const type = await fileTypeFromBuffer(buf);
			return { buf, isVideo: type?.mime?.startsWith("video") };
		};

		for (const [i, url] of result.media.entries()) {
			const { buf, isVideo } = await download(url);
			await m.reply({
				[isVideo ? "video" : "image"]: buf,
				...(i === 0 && result.caption
					? { caption: result.caption }
					: {}),
			});
		}
	},
};
