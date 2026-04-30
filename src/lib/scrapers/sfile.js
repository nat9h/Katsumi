/**
 * @file Sfile Downloader & Search Scraper.
 *
 * @remarks
 * Scraper utility for searching and downloading files from Sfile.mobi / Sfile.co.
 * Supports:
 * - File searching
 * - Metadata extraction
 * - Direct download link resolving
 * - Optional file buffer download
 *
 * wm by sh1naruu <✨️
 *
 * @author sh1njs
 * @license MIT
 */
import * as cheerio from "cheerio";

/**
 * Sfile utility object.
 *
 * @namespace sfile
 */
const sfile = {
	/**
	 * Create default request headers.
	 *
	 * @param {string} referer - Request referer URL.
	 * @returns {Record<string, string>} HTTP headers object.
	 */
	createHeaders: (referer) => ({
		"User-Agent":
			"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
		"sec-ch-ua":
			'"Not/A)Brand";v="8", "Chromium";v="137", "Google Chrome";v="137"',
		dnt: "1",
		"sec-ch-ua-mobile": "?1",
		"sec-ch-ua-platform": '"Android"',
		"sec-fetch-site": "same-origin",
		"sec-fetch-mode": "cors",
		"sec-fetch-dest": "empty",
		Referer: referer,
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.9",
	}),

	/**
	 * Extract cookies from response headers.
	 *
	 * @param {Headers} headers - Fetch response headers.
	 * @returns {string} Parsed cookie string.
	 */
	extractCookies: (headers) => {
		const raw = headers.get("set-cookie");
		if (!raw) {
			return "";
		}

		return raw
			.split(",")
			.map((c) => c.split(";")[0])
			.join("; ");
	},

	/**
	 * Extract file metadata from Sfile page HTML.
	 *
	 * @param {cheerio.CheerioAPI} $ - Cheerio instance.
	 * @returns {{
	 *   filename?: string,
	 *   mimetype?: string,
	 *   upload_date?: string,
	 *   download_count?: string,
	 *   author_name?: string
	 * }} Extracted metadata object.
	 */
	extractMetadata: ($) => {
		const m = {};

		m.filename = $(".overflow-hidden img").attr("alt")?.trim();
		m.mimetype = $(".divide-y span").first().text().trim();
		m.upload_date = $(".divide-y .font-semibold").eq(2).text().trim();
		m.download_count = $(".divide-y .font-semibold").eq(1).text().trim();
		m.author_name = $(".divide-y a").first().text().trim();

		return m;
	},

	/**
	 * Make a fetch request.
	 *
	 * @async
	 * @param {string} u - Request URL.
	 * @param {RequestInit} [o={}] - Fetch options.
	 * @returns {Promise<Response>} Fetch response object.
	 */
	makeRequest: async (u, o = {}) => {
		const res = await fetch(u, o);
		return res;
	},

	/**
	 * Search files from Sfile.
	 *
	 * @async
	 * @param {string} query - Search keyword.
	 * @param {number} [page=1] - Search result page number.
	 * @returns {Promise<Array<{
	 *   title: string,
	 *   size?: string,
	 *   upload_at?: string,
	 *   link: string
	 * }>>} Array of search results.
	 *
	 * @example
	 * const results = await sfile.search('minecraft');
	 *
	 * console.log(results);
	 */
	search: async (query, page = 1) => {
		const res = await fetch(
			`https://sfile.co/search.php?q=${query}&page=${page}`
		);

		const $ = cheerio.load(await res.text());
		const result = [];

		$(".group.px-2").each((_, el) => {
			const title = $(el).find(".min-w-0 a").text().trim();
			const link = $(el).find("a").attr("href");
			const elm = $(el).find(".mt-1").text().split("•");

			if (link) {
				result.push({
					title,
					size: elm[0]?.trim(),
					upload_at: elm[1]?.trim(),
					link,
				});
			}
		});

		return result;
	},

	/**
	 * Download file from Sfile.
	 *
	 * @async
	 * @param {string} url - Sfile file URL.
	 * @param {boolean} [resultBuffer=false]
	 * If true, returns downloaded file as Buffer.
	 * Otherwise returns direct download URL.
	 *
	 * @returns {Promise<{
	 *   metadata: {
	 *     filename?: string,
	 *     mimetype?: string,
	 *     upload_date?: string,
	 *     download_count?: string,
	 *     author_name?: string
	 *   },
	 *   download: string | Buffer
	 * }>} Download result object.
	 *
	 * @throws {Error}
	 * Throws if:
	 * - Initial request fails
	 * - Download URL is not found
	 * - Final download link extraction fails
	 * - File download request fails
	 *
	 * @example
	 * const data = await sfile.download(
	 *   'https://sfile.co/xxxxxxxx'
	 * );
	 *
	 * console.log(data.download);
	 *
	 * @example
	 * const data = await sfile.download(
	 *   'https://sfile.co/xxxxxxxx',
	 *   true
	 * );
	 *
	 * console.log(data.download instanceof Buffer);
	 */
	download: async (url, resultBuffer = false) => {
		try {
			let h = sfile.createHeaders(url);

			const init = await sfile.makeRequest(url, {
				headers: h,
			});

			if (!init.ok) {
				throw new Error(`Init request failed (${init.status})`);
			}

			const htmlInit = await init.text();

			const ck = sfile.extractCookies(init.headers);

			if (ck) {
				h.Cookie = ck;
			}

			let $ = cheerio.load(htmlInit);

			const meta = sfile.extractMetadata($);

			const dl = $("#download").attr("data-dw-url");

			if (!dl) {
				throw new Error("Download URL not found");
			}

			h.Referer = dl;

			const proc = await sfile.makeRequest(dl, {
				headers: h,
			});

			if (!proc.ok) {
				throw new Error(`Process request failed (${proc.status})`);
			}

			const htmlProc = await proc.text();

			$ = cheerio.load(htmlProc);

			const scr = $("script")
				.map((i, el) => $(el).html())
				.get()
				.join("\n");

			const re =
				/https:\\\/\\\/download\d+\.sfile\.co\\\/downloadfile\\\/\d+\\\/\d+\\\/[a-z0-9]+\\\/[^\s'"]+\.[a-z0-9]+(\?[^"']+)?/gi;

			const mt = scr.match(re);

			if (!mt?.length) {
				throw new Error("Final download link not found in script");
			}

			const fin = mt[0].replace(/\\\//g, "/");

			let download;

			if (resultBuffer) {
				const fileRes = await fetch(fin, {
					headers: h,
				});

				if (!fileRes.ok) {
					throw new Error(`File download failed (${fileRes.status})`);
				}

				const arrayBuffer = await fileRes.arrayBuffer();

				download = Buffer.from(arrayBuffer);
			} else {
				download = fin;
			}

			return {
				metadata: meta,
				download,
			};
		} catch (e) {
			throw new Error(e.message);
		}
	},
};

export default sfile;
