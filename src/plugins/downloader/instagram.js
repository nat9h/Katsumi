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
			return { buf, isVideo: type?.mime?.startsWith("video") };
		};

		const {
			username,
			title,
			like_count = 0,
			comment_count = 0,
			taken_at,
		} = result.metadata || {};
		const caption = `*@${username || "-"}*\n${title || "-"}\n${like_count} likes • ${comment_count} comments\n${taken_at ? new Date(taken_at * 1000).toLocaleString("id-ID") : ""}`;

		for (const [i, { url }] of result.contents.entries()) {
			const { buf, isVideo } = await download(url);
			await m.reply({
				[isVideo ? "video" : "image"]: buf,
				...(i === 0 && { caption }),
			});
		}
	},
};
