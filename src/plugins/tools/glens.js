import { GoogleLensClient } from "#lib/scrapers/glens";
import uploader from "#lib/uploader";

export default {
	name: "googlelens",
	description: "Detect sauce from Google Lens.",
	command: ["glens", "googlelens"],
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "tools",
	cooldown: 5,
	limit: true,
	usage: "$prefix$command <media>",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m) => {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q.type || "";
		if (!/image/i.test(mime)) {
			return m.reply("Please reply/send a media with the command.");
		}
		const media = await q.download();
		const buffer = Buffer.isBuffer(media)
			? media
			: Buffer.from(media, "utf-8");
		const url = await uploader.providers.freeimage.upload(buffer);

		const client = new GoogleLensClient();

		function formatLensResult(data) {
			const lines = [];

			if (data?.results?.length) {
				lines.push("*Search Results (top 5)*\n");
				data.results.slice(0, 5).forEach((r, i) => {
					lines.push(`${i + 1}. ${r.title}\n- ${r.link}\n`);
					if (r.desc) {
						lines.push(`- Desc: ${r.desc}`);
					}
				});
			}

			if (data?.images?.length) {
				lines.push("\n*Visual Matches (top 5)*\n");
				data.images.slice(0, 5).forEach((v, i) => {
					lines.push(
						`${i + 1}. ${v.title}\n- Source: ${v.source}\n- URL: ${v.image}`
					);
				});
			}

			return lines.length ? lines.join("\n") : "No results found.";
		}

		const data = await client.search(url);
		const text = formatLensResult(data);
		m.reply(text.trim());
	},
};
