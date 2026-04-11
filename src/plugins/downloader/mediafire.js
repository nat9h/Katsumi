import { Mediafire } from "#lib/scrapers/mediafire";

export default {
	name: "mediafire",
	description: "Mediafire Downloader.",
	command: ["mediafire", "mf"],
	usage: "$prefix$command https://www.mediafire.com/file/1fqjqg7e8e2v3ao/YOWA.v8.87_By.SamMods.apk/",
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
			return m.reply("Input URL Mediafire.");
		}

		const data = await Mediafire.download(input);

		return m.reply({
			document: { url: data.download },
			fileName: data.filename,
			mimetype: "*/*",
		});
	},
};
