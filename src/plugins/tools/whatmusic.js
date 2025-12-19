import uploader from "#lib/uploader";

export default {
	name: "whatmusic",
	description: "Detect song.",
	command: ["whatmusic", "detectsong"],
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

	execute: async (m, { api }) => {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q.type || "";
		if (!/audio|document/i.test(mime)) {
			return m.reply("Please reply/send a media with the command.");
		}
		const media = await q.download();
		const buffer = Buffer.isBuffer(media)
			? media
			: Buffer.from(media, "utf-8");
		const url = await uploader.providers.catbox.upload(buffer);
		const {
			data: { status, result, message },
		} = await api.Sayuran.get("/tools/whatmusic", { url });

		if (!status) {
			return m.reply(message);
		}

		let cap = `*Detected Songs*\n\n`;
		result.music.forEach((song, index) => {
			cap += `*${index + 1}. ${song.title}*\n`;
			cap += `- *Score:* ${song.score}\n`;
			cap += `- *Duration:* ${song.duration_ms / 1000}s\n`;
			cap += `- *Release Date:* ${song.release_date}\n`;
			cap += `- *Label:* ${song.label}\n`;
			cap += `- *Artists:* ${song.artists
				.map((artist) => artist.name)
				.join(", ")}\n`;
			cap += `- *Album:* ${song.album.name}\n`;
			if (song.external_metadata) {
				cap += `- *Spotify:* ${
					song.external_metadata.spotify?.track?.id
						? `https://open.spotify.com/track/${song.external_metadata.spotify.track.id}`
						: "N/A"
				}\n`;
				cap += `- *YouTube:* ${
					song.external_metadata.youtube?.vid
						? `https://www.youtube.com/watch?v=${song.external_metadata.youtube.vid}`
						: "N/A"
				}\n`;
				cap += `- *Deezer:* ${
					song.external_metadata.deezer?.track?.id
						? `https://www.deezer.com/track/${song.external_metadata.deezer.track.id}`
						: "N/A"
				}\n`;
			}
			cap += `\n`;
		});

		m.reply(cap.trim());
	},
};
