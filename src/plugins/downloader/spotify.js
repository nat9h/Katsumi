import { msToTime } from "#lib/functions";
import { to_audio } from "#utils/converter";

export default {
	name: "spotify",
	description: "Search for and download Spotify tracks.",
	command: ["spo", "spotify"],
	usage: "$prefix$command <url/query>",
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

	/**
	 * @param {import("../../lib/serialize").default} m
	 * @param {{ api: any, sock: import("baileys").WASocket }}
	 */
	async execute(m, { api, sock }) {
		if (!sock.spotify) {
			sock.spotify = {};
		}

		const input =
			m.text && m.text.trim() !== ""
				? m.text
				: m.quoted && m.quoted.url
					? m.quoted.url
					: null;

		if (!input) {
			return m.reply(
				"Please provide a Spotify track URL or a search query."
			);
		}

		const regex = /open\.spotify\.com\/track\/[A-Za-z0-9]+/;

		if (regex.test(input)) {
			const {
				data: { status, result, message },
			} = await api.Gratis.get("/downloader/spotify", { url: input });

			if (!status) {
				return m.reply(message);
			}

			await m.reply(
				"*Spotify Downloader*\n\n_Sending audio, please wait..._"
			);

			const response = await fetch(result.download_url);
			const buffer = Buffer.from(await response.arrayBuffer());

			return m.reply({
				audio: await to_audio(buffer, "mp3"),
				mimetype: "audio/mpeg",
			});
		}

		const {
			data: { status, result, message },
		} = await api.Sayuran.get("/search/spotify", { q: input });

		if (!status) {
			return m.reply(message);
		}

		let nginfo = `🕊 Spotify: *${input}*\n\n`;
		nginfo += "_Note: Reply with the number to download (e.g. 1)_\n\n";
		nginfo += "*List:*\n";
		result.forEach((track, i) => {
			nginfo += `*${i + 1}*. ${track.artist.join(", ")} - ${track.title}\n`;
		});
		const sent = await m.reply(nginfo.trim());

		sock.spotify[m.sender] = {
			results: result,
			messageId: sent.key.id,
		};

		setTimeout(() => {
			if (sock.spotify[m.sender]?.messageId === sent.key.id) {
				delete sock.spotify[m.sender];
				console.log(`Expired Spotify session for ${m.sender}`);
			}
		}, 60000);
	},

	/**
	 * Handles replies to the search result message.
	 * @param {import("../../lib/serialize").default} m
	 * @param {{ sock: import("baileys").WASocket, api: any }}
	 */
	async after(m, { sock, api }) {
		const session = sock.spotify?.[m.sender];

		if (!session || !m.quoted || m.quoted.id !== session.messageId) {
			return;
		}

		const tracks = session.results;
		const choice = parseInt(m.body.trim());

		if (isNaN(choice) || choice < 1 || choice > tracks.length) {
			m.reply(
				"Invalid number. Please run the command again to start a new search."
			);
			delete sock.spotify[m.sender];
			return;
		}

		const track = tracks[choice - 1];
		delete sock.spotify[m.sender];

		if (!track.track_url) {
			return m.reply("Download link not available for this track.");
		}

		const {
			data: { status, result, message },
		} = await api.Gratis.get("/downloader/spotify", {
			url: track.track_url,
		});

		if (!status) {
			return m.reply(message);
		}

		let antemi = "*Spotify Downloader*\n\n";
		antemi += `*Title:* ${track.title}\n`;
		antemi += `*Artist:* ${track.artist.join(", ")}\n`;
		antemi += `*Release Date:* ${track.release_date}\n`;
		antemi += `*Duration:* ${msToTime(track.duration_ms)}\n\n`;
		antemi += "_Sending audio, please wait..._";

		await m.reply({
			image: { url: track.cover_url },
			caption: antemi,
		});

		const response = await fetch(result.download_url);
		const buffer = Buffer.from(await response.arrayBuffer());

		return m.reply({
			audio: await to_audio(buffer, "mp3"),
			mimetype: "audio/mpeg",
		});
	},
};
