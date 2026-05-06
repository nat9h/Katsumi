import axios from "axios";

export class FacebookDownloader {
	constructor(options = {}) {
		this.cookie = options.cookie || "";
		this.userAgent =
			options.userAgent ||
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
		this.timeout = options.timeout || 30_000;

		this.client =
			options.client ||
			axios.create({
				timeout: this.timeout,
				maxRedirects: 5,
				responseType: "text",
				transformResponse: [
					(data) => {
						return data;
					},
				],
				validateStatus: (status) => {
					return status >= 200 && status < 400;
				},
			});
	}

	async download(postUrl, options = {}) {
		const url = this.validateUrl(postUrl);
		const html = await this.fetchHtml(url.href, options);
		const normalizedHtml = FacebookDownloader.normalizeHtml(html);

		const images = this.extractImages(normalizedHtml);
		const sd = this.extractSdUrl(normalizedHtml);
		const hd = this.extractHdUrl(normalizedHtml);
		const thumbnail = this.extractThumbnail(normalizedHtml);

		let type = "none";

		if (images.length > 0) {
			type = "image";
		} else if (sd || hd) {
			type = "video";
		}

		return {
			type,
			url: url.href,
			image: images.length > 0 ? images : null,
			externalUrl: this.extractExternalUrl(normalizedHtml),
			comments: this.extractComments(normalizedHtml),
			title: this.extractTitle(normalizedHtml),
			duration_ms: this.extractDuration(normalizedHtml),
			sd,
			hd,
			thumbnail,
		};
	}

	validateUrl(input) {
		const value = String(input || "").trim();

		if (!value) {
			throw new Error("Please specify the Facebook URL");
		}

		let url;

		try {
			url = new URL(value);
		} catch {
			throw new Error("Please enter a valid Facebook URL");
		}

		const hostname = url.hostname.toLowerCase();

		const isFacebook =
			hostname === "facebook.com" ||
			hostname.endsWith(".facebook.com") ||
			hostname === "fb.watch" ||
			hostname.endsWith(".fb.watch");

		if (!isFacebook) {
			throw new Error("Please enter a valid Facebook URL");
		}

		return url;
	}

	buildHeaders(options = {}) {
		const cookie = options.cookie ?? this.cookie;
		const userAgent = options.userAgent ?? this.userAgent;

		return {
			authority: "www.facebook.com",
			accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
			"accept-language": "en-GB,en;q=0.9,en-US;q=0.8,id;q=0.7",
			"cache-control": "max-age=0",
			"sec-ch-ua":
				'"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
			"sec-ch-ua-mobile": "?0",
			"sec-fetch-dest": "document",
			"sec-fetch-mode": "navigate",
			"sec-fetch-site": "none",
			"sec-fetch-user": "?1",
			"upgrade-insecure-requests": "1",
			"user-agent": userAgent,
			cookie: cookie || "",
		};
	}

	async fetchHtml(url, options = {}) {
		try {
			const { data } = await this.client.get(url, {
				headers: this.buildHeaders(options),
				signal: options.signal,
				timeout: options.timeout || this.timeout,
			});

			return String(data || "");
		} catch (error) {
			if (error?.code === "ECONNABORTED") {
				throw new Error(
					"Facebook request timed out. Please try again."
				);
			}

			const status = error?.response?.status;

			if (status) {
				throw new Error(
					`Unable to fetch Facebook media. HTTP status: ${status}`
				);
			}

			throw new Error(
				"Unable to fetch media information at this time. Please try again."
			);
		}
	}

	extractExternalUrl(html) {
		const raw = FacebookDownloader.firstMatch(html, [
			/"__typename":"ExternalWebLink","url":"(https:[^"]+)"/,
		]);

		if (!raw) {
			return null;
		}

		return FacebookDownloader.decodeValue(raw);
	}

	extractImages(html) {
		const matches =
			html.match(
				/https:\/\/scontent\.[^"'<>\s]+?\.jpg(?:\?[^"'<>\s]*)?/g
			) || [];

		const seen = new Set();

		return matches
			.map((url) => {
				return FacebookDownloader.decodeValue(url);
			})
			.filter((url) => {
				if (!url.includes("/v/t39.30808-6/")) {
					return false;
				}

				if (/\/s\d{1,4}x\d{1,4}\//.test(url)) {
					return false;
				}

				const baseUrl = url.split("?")[0];

				if (seen.has(baseUrl)) {
					return false;
				}

				seen.add(baseUrl);
				return true;
			});
	}

	extractComments(html) {
		const comments = [];
		const seen = new Set();

		const pattern =
			/"author":\{"__typename":"User","id":"(.*?)","name":"(.*?)".*?"body":\{"text":"(.*?)"/gs;

		for (const match of html.matchAll(pattern)) {
			const id = FacebookDownloader.decodeValue(match[1]);
			const name = FacebookDownloader.decodeValue(match[2]);
			const text = FacebookDownloader.cleanText(match[3]);

			const key = `${id}:${text}`;

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);

			comments.push({
				author: {
					id,
					name,
				},
				text,
			});
		}

		return comments;
	}

	extractSdUrl(html) {
		const raw = FacebookDownloader.firstMatch(html, [
			/"browser_native_sd_url":"(.*?)"/,
			/"playable_url":"(.*?)"/,
			/sd_src\s*:\s*"([^"]*)"/,
			/(?<="src":")[^"]*(https:\/\/[^"]*)/,
		]);

		if (!raw) {
			return null;
		}

		return FacebookDownloader.decodeValue(raw);
	}

	extractHdUrl(html) {
		const raw = FacebookDownloader.firstMatch(html, [
			/"browser_native_hd_url":"(.*?)"/,
			/"playable_url_quality_hd":"(.*?)"/,
			/hd_src\s*:\s*"([^"]*)"/,
		]);

		if (!raw) {
			return null;
		}

		return FacebookDownloader.decodeValue(raw);
	}

	extractTitle(html) {
		const raw = FacebookDownloader.firstMatch(html, [
			/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i,
			/<title[^>]*>(.*?)<\/title>/is,
		]);

		if (!raw) {
			return "";
		}

		return FacebookDownloader.cleanText(raw);
	}

	extractThumbnail(html) {
		const raw = FacebookDownloader.firstMatch(html, [
			/"preferred_thumbnail":\{"image":\{"uri":"(.*?)"/,
			/"thumbnailImage":\{"uri":"(.*?)"/,
			/"thumbnail_url":"(.*?)"/,
		]);

		if (!raw) {
			return null;
		}

		return FacebookDownloader.decodeValue(raw);
	}

	extractDuration(html) {
		const raw = FacebookDownloader.firstMatch(html, [
			/"playable_duration_in_ms":(\d+)/,
			/"duration_in_ms":(\d+)/,
		]);

		if (!raw) {
			return null;
		}

		return Number(raw);
	}

	static firstMatch(input, patterns = []) {
		for (const pattern of patterns) {
			const match = input.match(pattern);

			if (match?.[1]) {
				return match[1];
			}
		}

		return null;
	}

	static normalizeHtml(input) {
		return FacebookDownloader.decodeHtml(String(input || ""))
			.replace(/&amp;/g, "&")
			.replace(/&quot;/g, '"')
			.replace(/\\\//g, "/");
	}

	static decodeValue(input) {
		if (input == null) {
			return null;
		}

		let value = String(input);

		try {
			value = JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
		} catch {
			value = value
				.replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) => {
					return String.fromCharCode(Number.parseInt(hex, 16));
				})
				.replace(/\\\//g, "/");
		}

		return FacebookDownloader.decodeHtml(value).trim();
	}

	static decodeHtml(input) {
		return String(input || "")
			.replace(/&#(\d+);/g, (_, code) => {
				return String.fromCharCode(Number.parseInt(code, 10));
			})
			.replace(/&#x([\dA-Fa-f]+);/g, (_, code) => {
				return String.fromCharCode(Number.parseInt(code, 16));
			})
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&apos;/g, "'")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">");
	}

	static cleanText(input) {
		return FacebookDownloader.decodeValue(input)
			.replace(/\s+/g, " ")
			.trim();
	}
}

export default async function fesnuk(post, cookie, useragent) {
	const downloader = new FacebookDownloader({
		cookie,
		userAgent: useragent,
	});

	return downloader.download(post);
}
