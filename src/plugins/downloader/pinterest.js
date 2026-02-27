import { sleep } from "#lib/functions";
import { Pinterest } from "#lib/scrapers/pinterest";

export default {
	name: "pinterest",
	description:
		"Pinterest search & downloader (supports pin.it / pinterest.com).",
	command: ["pin", "pinterest"],
	usage: [
		"$prefix$command https://pin.it/xxxx",
		"$prefix$command chitoge kirisaki",
		"$prefix$command chitoge kirisaki -10",
	].join("\n"),
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
				? m.text.trim()
				: m.quoted && (m.quoted.url || m.quoted.text)
					? String(m.quoted.url || m.quoted.text).trim()
					: null;

		if (!input) {
			return m.reply(
				"Input query or link Pinterest.\n" +
					"Example:\n" +
					`- *${m.prefix + m.command}* cat -10 (default 1)\n` +
					`- *${m.prefix + m.command}* https://pin.it/xxxx`
			);
		}

		const p = new Pinterest();

		if (m.isUrl(input) && isPinterestLink(input)) {
			const info = await p.download(input);

			if (!info?.src) {
				return m.reply("Failed to get media.");
			}

			const caption =
				"*_📌 PINTEREST DOWNLOADER*_\n\n" +
				`*🔗 URL*: ${info.finalUrl}\n` +
				`*📦 Type*: ${info.type}\n` +
				`*📝 Description*: ${info.description || "-"}\n`;

			if (info.type === "video") {
				await m.reply({
					video: { url: info.src },
					caption: caption.trim(),
				});
			} else {
				await m.reply({
					image: { url: info.src },
					caption: caption.trim(),
				});
			}
			return;
		}

		const { query, limit } = parseLimitFlag(input, 1, 1, 25);
		if (!query) {
			return m.reply(
				`Input query. Example: ${m.prefix + m.command} cat -10`
			);
		}

		const results = await p.search(query);

		if (!Array.isArray(results) || results.length === 0) {
			return m.reply("Query not found.");
		}

		const picked = results.slice(0, limit);

		await m.reply(
			"*🔎 PINTEREST SEARCH*\n\n" +
				`*Query*: ${query}\n` +
				`*Result*: ${picked.length}/${results.length}\n` +
				"*Tip*: use *-10* to get 10 results"
		);

		const shouldDelay = picked.length > 1;
		const delayMs = 1200;

		for (let i = 0; i < picked.length; i++) {
			const item = picked[i];

			const text =
				`*${item.type === "video" ? "🎞️" : "🖼️"} ${item.title || "Untitled"}*\n\n` +
				`*👤 Author*: ${item.author || "-"}\n` +
				`*🔗 Source*: ${item.source}\n`;

			if (item.type === "video" && item.video) {
				await m.reply({
					video: { url: item.video },
					caption: text.trim(),
				});
			} else if (item.image) {
				await m.reply({
					image: { url: item.image },
					caption: text.trim(),
				});
			} else {
				await m.reply(text.trim());
			}

			if (shouldDelay && i < picked.length - 1) {
				await sleep(delayMs);
			}
		}
	},
};

function isPinterestLink(s) {
	return /(^https?:\/\/)?(www\.)?(pin\.it|pinterest\.com)\//i.test(s);
}

/**
 * Parse "-N" at the end (or anywhere) from user input.
 * Example: "chitoge kirisaki -10" -> { query: "chitoge kirisaki", limit: 10 }
 */
function parseLimitFlag(text, def = 5, min = 1, max = 25) {
	const tokens = text.trim().split(/\s+/);
	let limit = def;

	const idx = [...tokens].reverse().findIndex((t) => /^-\d+$/.test(t));
	if (idx !== -1) {
		const realIdx = tokens.length - 1 - idx;
		const n = parseInt(tokens[realIdx].slice(1), 10);
		if (!Number.isNaN(n)) {
			limit = n;
		}
		tokens.splice(realIdx, 1);
	}

	limit = Math.max(min, Math.min(max, limit));
	const query = tokens.join(" ").trim();

	return { query, limit };
}
