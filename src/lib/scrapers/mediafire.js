/**
 * @file Mediafire Downloader.
 *
 * @remarks
 * wm by natsumiworld <3
 *
 * @author Natsyn
 * @license MIT
 */
import { basename, extname } from "node:path";

export class Mediafire {
	constructor({
		timeoutMs = 15000,
		userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
		acceptLanguage = "en-US,en;q=0.9,id;q=0.8",
	} = {}) {
		this.timeoutMs = timeoutMs;
		this.userAgent = userAgent;
		this.acceptLanguage = acceptLanguage;
	}

	async getElement(url) {
		const controller = new AbortController();
		const t = setTimeout(() => controller.abort(), this.timeoutMs);

		try {
			const res = await fetch(url, {
				signal: controller.signal,
				headers: {
					"user-agent": this.userAgent,
					"accept-language": this.acceptLanguage,
				},
				redirect: "follow",
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status} ${res.statusText}`);
			}
			return await res.text();
		} catch (e) {
			if (e?.name === "AbortError") {
				throw new Error(`Timeout after ${this.timeoutMs}ms`);
			}
			throw e;
		} finally {
			clearTimeout(t);
		}
	}

	decodeEntities(s = "") {
		return s
			.replace(/&amp;/g, "&")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
			.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
				String.fromCharCode(parseInt(h, 16))
			);
	}

	normalizeUrl(href, baseUrl) {
		try {
			return new URL(href, baseUrl).toString();
		} catch {
			return href;
		}
	}

	parseAttributes(tagText) {
		const attrs = Object.create(null);

		const inside = tagText
			.replace(/^<\s*[\w:-]+\s*/i, "")
			.replace(/\/?\s*>$/i, "");

		let i = 0;
		const len = inside.length;

		const isSpace = (c) =>
			c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";

		const skipSpaces = () => {
			while (i < len && isSpace(inside[i])) {
				i++;
			}
		};

		const readName = () => {
			const start = i;
			while (i < len) {
				const c = inside[i];
				if (isSpace(c) || c === "=" || c === ">" || c === "/") {
					break;
				}
				i++;
			}
			return inside.slice(start, i);
		};

		const readValue = () => {
			skipSpaces();
			if (i >= len) {
				return "";
			}

			const q = inside[i];
			if (q === '"' || q === "'") {
				i++;
				const start = i;
				while (i < len && inside[i] !== q) {
					i++;
				}
				const val = inside.slice(start, i);
				if (inside[i] === q) {
					i++;
				}
				return val;
			}

			const start = i;
			while (i < len) {
				const c = inside[i];
				if (isSpace(c) || c === ">") {
					break;
				}
				i++;
			}
			return inside.slice(start, i);
		};

		while (i < len) {
			skipSpaces();
			if (i >= len) {
				break;
			}

			const name = readName();
			if (!name) {
				break;
			}

			skipSpaces();
			let value = "";

			if (inside[i] === "=") {
				i++;
				value = readValue();
			} else {
				value = "";
			}

			attrs[name.toLowerCase()] = value;
		}

		return attrs;
	}

	hasClass(classAttr, wanted) {
		if (!classAttr) {
			return false;
		}
		return classAttr.split(/\s+/).some((c) => c === wanted);
	}

	extractOgTitle(html) {
		const re = /<meta\b[^>]*>/gi;
		let m;
		while ((m = re.exec(html))) {
			const tag = m[0];
			const attrs = this.parseAttributes(tag);
			const prop = (attrs.property || attrs.name || "")
				.trim()
				.toLowerCase();
			if (prop === "og:title") {
				const content = (attrs.content || "").trim();
				if (content) {
					return this.decodeEntities(content);
				}
			}
		}
		return null;
	}

	extractSize(html) {
		return /Download\s*\(([\d.]+\s*[KMGT]?B)\)/i.exec(html)?.[1] ?? null;
	}

	extractDownloadLink(html) {
		const re = /<a\b[^>]*>/gi;
		let best = null;
		let fallback = null;

		let m;
		while ((m = re.exec(html))) {
			const tag = m[0];
			const attrs = this.parseAttributes(tag);

			if (!this.hasClass(attrs.class, "popsok")) {
				continue;
			}

			const href = (attrs.href || "").trim();
			if (!href) {
				continue;
			}

			if (!best && /^https:\/\/download/i.test(href)) {
				best = href;
			}
			if (!fallback && !/^javascript:/i.test(href)) {
				fallback = href;
			}

			if (best) {
				break;
			}
		}

		return best || fallback;
	}

	async get(url) {
		const link = url.trim();
		if (!/^https?:\/\/(?:[\w-]+\.)*mediafire\.com\/.+/i.test(link)) {
			throw new Error("URL must be a MediaFire link (*.mediafire.com).");
		}

		const html = await this.getElement(link);

		const title = this.extractOgTitle(html) || "Unknown";
		const size = this.extractSize(html) || "Unknown";

		let dl = this.extractDownloadLink(html);
		if (!dl) {
			throw new Error("Download URL not found.");
		}

		dl = this.normalizeUrl(dl, link);

		return {
			name: title,
			filename: basename(dl),
			type: extname(dl),
			size,
			download: dl,
			link,
		};
	}

	static async download(url, opts) {
		return new Mediafire(opts).get(url);
	}
}

// Mediafire.download(
// 	"https://www.mediafire.com/file/1fqjqg7e8e2v3ao/YOWA.v8.87_By.SamMods.apk/"
// )
// 	.then(console.log)
// 	.catch(console.error);
