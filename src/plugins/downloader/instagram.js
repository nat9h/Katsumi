import { fileTypeFromBuffer } from "file-type";

export default {
	name: "instagram",
	description: "Downloader Instagram.",
	command: ["ig", "instagram"],
	usage: "$prefix$command https://www.instagram.com/reel/C_Fyz3bJ2PF/",
	permissions: "all",
	hidden: false,
	failed: "Failed to execute %command: %error",
	wait: null,
	category: "downloader",
	cooldown: 5,
	limit: false,
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
			return m.reply("Input URL Instagram.");
		}

		const {
			data: { result, status, message },
		} = await api.Gratis.get("/downloader/instagram", { url: input });

		if (!status) {
			return m.reply(message);
		}

		const download = async (url) => {
			const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
			const type = await fileTypeFromBuffer(buf);
			const key = type?.mime?.startsWith("video") ? "video" : "image";
			return { [key]: buf };
		};

		for (const item of result?.contents) {
			await m.reply(await download(item.url));
		}
	},
};
