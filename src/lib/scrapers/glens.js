/**
 * @file Google Lens.
 *
 * @remarks
 * wm by natsumiworld <3 / ty: k6th.
 *
 * @author Natsyn
 * @license MIT
 */

/**
 * @typedef {Object} GoogleLensClientOptions
 * @property {string} [userAgent] - User-Agent to send with requests.
 * @property {Record<string, string>} [headers] - Additional headers to merge over defaults.
 * @property {number} [timeoutMs=60000] - Request timeout in milliseconds.
 */

/**
 * A parsed "search result" entry from the Google Lens response.
 * @typedef {Object} GoogleLensSearchResult
 * @property {string} title - Result title.
 * @property {string} desc - Short description/snippet.
 * @property {string} link - Destination URL.
 */

/**
 * A parsed "visual match" card from the Google Lens response.
 * @typedef {Object} GoogleLensImageMatch
 * @property {string} image - Full image URL.
 * @property {string} icon - Source favicon/icon URL.
 * @property {string} title - Card title.
 * @property {string} source - Source page URL.
 */

/**
 * The normalized output of {@link GoogleLensClient#search}.
 * @typedef {Object} GoogleLensData
 * @property {GoogleLensSearchResult[]} results - Parsed search results (best-effort).
 * @property {GoogleLensImageMatch[]} images - Parsed visual matches (best-effort).
 */

export class GoogleLensClient {
	/** @type {Record<string, string>} */
	#headers;

	/** @type {number} */
	#timeoutMs;

	/**
	 * Create a GoogleLensClient.
	 *
	 * @param {GoogleLensClientOptions} [options]
	 */
	constructor({ userAgent, headers, timeoutMs = 60_000 } = {}) {
		const ua = userAgent || GoogleLensClient.DEFAULT_UA;
		this.#headers = { ...GoogleLensClient.DEFAULT_HEADERS(ua), ...headers };
		this.#timeoutMs = timeoutMs;
	}

	/**
	 * Perform a Google Lens search by providing a public image URL.
	 *
	 * Note: This method fetches a text-rendered version of the Lens page via `r.jina.ai`
	 * and then parses the content heuristically.
	 *
	 * @param {string} imageUrl - Publicly reachable image URL (http/https).
	 * @returns {Promise<GoogleLensData>} Parsed results and visual matches.
	 * @throws {Error} If the HTTP request fails (non-2xx response).
	 */
	async search(imageUrl) {
		const target = `https://r.jina.ai/https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
		const res = await fetch(target, {
			headers: this.#headers,
			signal: AbortSignal.timeout(this.#timeoutMs),
		});

		if (!res.ok) {
			throw new Error(`HTTP Error: ${res.status}`);
		}
		return GoogleLensClient.#extractData(await res.text());
	}

	/** @type {string} */
	static DEFAULT_UA =
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

	/**
	 * Build default headers for requests.
	 * @param {string} ua - User-Agent string.
	 * @returns {Record<string, string>}
	 */
	static DEFAULT_HEADERS = (ua) => ({
		"User-Agent": ua,
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.7",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		Origin: "https://lens.google.com",
	});

	/**
	 * Check whether a value is an http/https URL.
	 * @private
	 * @param {string} u
	 * @returns {boolean}
	 */
	static #isUrl = (u) => {
		try {
			return new URL(u).protocol.startsWith("http");
		} catch {
			return false;
		}
	};

	/**
	 * Detect "junk" titles/snippets that should be ignored.
	 * @private
	 * @param {string} t
	 * @returns {boolean}
	 */
	static #isJunk = (t) =>
		!t.trim() || /^\d+:\d{2}$/.test(t) || t.startsWith("![");

	/**
	 * Normalize response text to improve parse reliability.
	 * - Removes CRLF artifacts
	 * - Removes whitespace that may appear inside URLs
	 * @private
	 * @param {string} str
	 * @returns {string}
	 */
	static #clean = (str) =>
		str
			.replace(/\r/g, "")
			.replace(/https?:\/\/[^\s)\]]+/g, (m) => m.replace(/\s+/g, ""))
			.replace(
				/\(\s*(https?:\/\/[\s\S]*?)\s*\)/g,
				(_, u) => `(${u.replace(/\s+/g, "")})`
			);

	/**
	 * Extract a slice of text starting from the earliest matching start marker,
	 * optionally ending before the first occurrence of `end`.
	 * @private
	 * @param {string} text
	 * @param {string[]} starts
	 * @param {string} end
	 * @returns {string}
	 */
	static #slice(text, starts, end) {
		const idx = Math.min(
			...starts.map((s) => text.indexOf(s)).filter((i) => i >= 0)
		);
		if (idx === Infinity) {
			return "";
		}
		const sub = text.slice(idx);
		const e = sub.indexOf(end);
		return e < 0 ? sub : sub.slice(0, e);
	}

	/**
	 * Extract and parse result blocks from the raw response text.
	 * @private
	 * @param {string} raw
	 * @returns {GoogleLensData}
	 */
	static #extractData(raw) {
		const text = GoogleLensClient.#clean(raw);
		const visual = GoogleLensClient.#slice(
			text,
			[
				"Visual matches\n--------------",
				"Related search\n--------------",
			],
			"Footer Links"
		);
		const results = GoogleLensClient.#slice(
			text,
			["Search Results"],
			"Show more"
		);
		return {
			results: GoogleLensClient.#parseResults(results || visual),
			images: GoogleLensClient.#parseImages(visual),
		};
	}

	/**
	 * Parse "visual match" cards (image + source icon + title + link).
	 * @private
	 * @param {string} block
	 * @returns {GoogleLensImageMatch[]}
	 */
	static #parseImages(block) {
		const chunks = block.split("\n\n").filter(Boolean);
		const rImg = /!\[[^\]]*?\]\((.*?)\)/;
		const rCard = /\[!\[[^\]]*?\]\((.*?)\)\s*([^\]]*?)\]\((.*?)\)/;
		const out = [];

		for (let i = 0; i < chunks.length; i++) {
			const img = rImg.exec(chunks[i]),
				card = rCard.exec(chunks[i]);
			if (img && !card) {
				const next = rCard.exec(chunks[i + 1] || "");
				if (next) {
					out.push({
						image: img[1],
						icon: next[1],
						title: next[2],
						source: next[3],
					});
				}
			} else if (card && !img) {
				const prev = rImg.exec(chunks[i - 1] || "");
				if (prev) {
					out.push({
						image: prev[1],
						icon: card[1],
						title: card[2],
						source: card[3],
					});
				}
			} else if (img && card) {
				out.push({
					image: img[1],
					icon: card[1],
					title: card[2],
					source: card[3],
				});
			}
		}

		const seen = new Set();
		return out
			.map((o) => ({
				image: (o.image || "").trim(),
				icon: (o.icon || "").trim(),
				title: (o.title || "").trim(),
				source: (o.source || "").trim(),
			}))
			.filter(
				(o) =>
					GoogleLensClient.#isUrl(o.source) &&
					GoogleLensClient.#isUrl(o.image) &&
					GoogleLensClient.#isUrl(o.icon) &&
					!o.image.startsWith("blob:") &&
					!o.icon.startsWith("blob:") &&
					!o.image.includes("localhost") &&
					!o.icon.includes("localhost") &&
					!GoogleLensClient.#isJunk(o.title) &&
					((k) => !seen.has(k) && !!seen.add(k))(
						`${o.source}||${o.title}||${o.image}`
					)
			);
	}

	/**
	 * Parse "Search Results" entries.
	 * @private
	 * @param {string} block
	 * @returns {GoogleLensSearchResult[]}
	 */
	static #parseResults(block) {
		const seen = new Set();
		return block
			.split("\n\n")
			.filter((s) => s.startsWith("[###"))
			.map((s) => {
				const m =
					/\[###\s*(.*?)\s*!\[[^\]]*?\]\([^)]*?\)\s*(.*?)\]\((.*?)\)/.exec(
						s
					);
				return (
					m && {
						title: m[1].trim(),
						desc: m[2].trim(),
						link: m[3].trim(),
					}
				);
			})
			.filter(Boolean)
			.filter(
				(o) =>
					o.title &&
					GoogleLensClient.#isUrl(o.link) &&
					((k) => !seen.has(k) && !!seen.add(k))(o.link)
			);
	}
}

// const client = new GoogleLensClient();
// client
// 	.search(
// 		"https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png"
// 	)
// 	.then((d) => console.dir(d, { depth: null }))
// 	.catch((e) => console.error("Error:", e.message));
