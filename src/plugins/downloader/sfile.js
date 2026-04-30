import sfile from "#lib/scrapers/sfile";

export default {
	name: "sfile",
	description: "Search and download files from sfile.co.",
	command: ["sfile", "sf"],
	usage: "$prefix$command <query|sfile_url>",
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "downloader",
	cooldown: 10,
	limit: false,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m, { sock }) => {
		if (!sock.sfile) {
			sock.sfile = {};
		}

		const query = m.text?.trim();
		if (!query) {
			return m.reply(
				"Please provide a query or sfile.co URL.\nUsage: " +
					`${m.prefix}sfile <query|url>`
			);
		}

		const urlMatch = query.match(/https?:\/\/sfile\.co\/\S+/i);
		if (urlMatch) {
			const { metadata, download } = await sfile.download(urlMatch[0]);

			return await m.reply({
				document: { url: download },
				mimetype: metadata.mimetype || "application/octet-stream",
				fileName: metadata.filename || "file",
				caption:
					`✅ *${metadata.filename}*\n` +
					`📅 Uploaded: ${metadata.upload_date}\n` +
					`👤 Author: ${metadata.author_name}`,
			});
		}

		const results = await sfile.search(query);
		if (!results.length) {
			return m.reply("No results found.");
		}

		const listMsg = results
			.map(
				(f, i) =>
					`*${i + 1}.* ${f.title}\n` +
					`Size: ${f.size} | Uploaded: ${f.upload_at}\n` +
					`Link: ${f.link}`
			)
			.join("\n\n");

		const sent = await m.reply(
			"*Sfile Search Results*\n\n" +
				`Query: _${query}_\n\n` +
				"_Reply with the *number* of the file you wish to download._\n\n" +
				"*List:*\n\n" +
				listMsg.trim()
		);

		sock.sfile[m.sender] = {
			results,
			messageId: sent.key.id,
		};

		setTimeout(() => {
			if (sock.sfile[m.sender]?.messageId === sent.key.id) {
				delete sock.sfile[m.sender];
			}
		}, 90000);
	},

	after: async (m, { sock }) => {
		const session = sock.sfile?.[m.sender];
		if (!session || !m.quoted || m.quoted.id !== session.messageId) {
			return;
		}

		const { results } = session;
		const idx = parseInt(m.body.trim());

		if (isNaN(idx) || idx < 1 || idx > results.length) {
			m.reply(
				"Invalid number. Please run the command again to start a new search."
			);
			delete sock.sfile[m.sender];
			return;
		}

		const chosen = results[idx - 1];
		delete sock.sfile[m.sender];

		await m.reply(
			"Preparing your download...\n\n" +
				`File: *${chosen.title}*\n` +
				`Size: *${chosen.size}*\n\n` +
				"_Your file will be sent shortly._"
		);

		const { metadata, download } = await sfile.download(chosen.link);

		await m.reply({
			document: { url: download },
			mimetype: metadata.mimetype || "application/octet-stream",
			fileName: metadata.filename || chosen.title,
			caption:
				`✅ *${metadata.filename}*\n` +
				`📦 Size: ${chosen.size}\n` +
				`📅 Uploaded: ${metadata.upload_date}\n` +
				`👤 Author: ${metadata.author_name}`,
		});
	},
};
