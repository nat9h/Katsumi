export default {
	name: "lyrics",
	description: "Search for lyrics.",
	command: ["lyrics", "lirik"],
	usage: "$prefix$command yung kai blue",
	permissions: "all",
	hidden: false,
	failed: "Failed to execute %command: %error",
	wait: null,
	category: "tools",
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
		if (!sock.lyrics) {
			sock.lyrics = {};
		}

		const input =
			m.text && m.text.trim() !== ""
				? m.text
				: m.quoted && m.quoted.text
					? m.quoted.text
					: null;

		if (!input) {
			return m.reply(
				"Please provide a song title or artist name to search for lyrics."
			);
		}

		const {
			data: { status, result, message },
		} = await api.Sayuran.get("/search/lyrics", { text: input });

		if (!status) {
			return m.reply(message);
		}

		let nginfo = `Lyrics: *${input}*\n\n`;
		nginfo +=
			"_Note: Reply with the number to get full lyrics (e.g. 1)_\n\n";
		nginfo += "*List:*\n";
		result.forEach((track, i) => {
			nginfo += `*${i + 1}*. ${track.artist} - ${track.title}\n`;
		});
		nginfo += `\n_Timeout in 60 seconds_`;

		const sent = await m.reply(nginfo.trim());

		sock.lyrics[m.sender] = {
			results: result,
			messageId: sent.key.id,
		};

		setTimeout(() => {
			if (sock.lyrics[m.sender]?.messageId === sent.key.id) {
				delete sock.lyrics[m.sender];
			}
		}, 60000);
	},

	/**
	 * Handles replies to the search result message.
	 * @param {import("../../lib/serialize").default} m
	 * @param {{ sock: import("baileys").WASocket, api: any }}
	 */
	async after(m, { sock, api }) {
		const session = sock.lyrics?.[m.sender];

		if (!session || !m.quoted || m.quoted.id !== session.messageId) {
			return;
		}

		const tracks = session.results;
		const choice = parseInt(m.body.trim());

		if (isNaN(choice) || choice < 1 || choice > tracks.length) {
			await m.reply(
				"Invalid number. Please run the command again to start a new search."
			);
			delete sock.lyrics[m.sender];
			return;
		}

		const track = tracks[choice - 1];
		delete sock.lyrics[m.sender];

		const {
			data: { status, result, message },
		} = await api.Sayuran.get("/search/lyrics/get", {
			id: track.id,
		});

		if (!status) {
			return m.reply(message);
		}

		let clean = result.lyrics || "";

		clean = clean.replace(/^\d+\s+Contributors[\s\S]*?Lyrics/i, "").trim();

		let lyrics = `*${result.title}* by ${result.artist}\n\n`;
		lyrics += clean.replace(/\[.*?\]/g, (match) => `\n*${match}*`).trim();

		await m.reply({ image: { url: track.thumbnail }, caption: lyrics });
	},
};
