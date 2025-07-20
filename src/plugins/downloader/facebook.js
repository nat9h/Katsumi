import fesnuk from "#lib/scraper/facebook";

export default {
	name: "facebook",
	description: "Downloader Facebook.",
	command: ["fb", "facebook"],
	usage: "$prefix$command https://fb.watch/AaMe9-GxhW/",
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

	execute: async (m) => {
		const input =
			m.text && m.text.trim() !== ""
				? m.text
				: m.quoted && m.quoted.url
					? m.quoted.url
					: null;

		if (!input) {
			return m.reply("Input URL Facebook.");
		}

		const result = await fesnuk(input);

		if (!result) {
			return m.reply("Failed.");
		}

		let caption = `*${result.type === "video" ? "Video" : "Post"} Facebook.*\n\n`;
		caption += `*Title:*\n${result.title || "Facebook"}\n`;
		caption += `*Source:*\n${result.url}\n`;

		if (result.externalUrl) {
			caption += `*External URL:* ${result.externalUrl}\n`;
		}

		if (
			result.comments &&
			Array.isArray(result.comments) &&
			result.comments.length > 0
		) {
			caption += "\n💬 *Top Comments:*\n";
			const topComments = result.comments.slice(0, 3);
			for (const comment of topComments) {
				if (comment.text && comment.text.trim() !== "") {
					caption += `*- ${comment.author.name}:* ${comment.text}\n`;
				}
			}
		}

		if (
			result.type === "image" &&
			Array.isArray(result.image) &&
			result.image.length > 0
		) {
			for (let i = 0; i < result.image.length; i++) {
				const imageUrl = result.image[i];
				await m.reply({
					image: { url: imageUrl },
					caption: i === 0 ? caption.trim() : "",
				});
			}
			return;
		}

		if (result.type === "video" && (result.hd || result.sd)) {
			const videoUrl = result.hd || result.sd;
			const quality = result.hd ? "HD" : "SD";
			let videoCaption = `*Quality:* ${quality}\n` + caption;
			return m.reply({
				video: { url: videoUrl },
				caption: videoCaption.trim(),
			});
		}
	},
};
