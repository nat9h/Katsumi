/**
 * @file Pinterest search & downloader (supports pin.it and pinterest.com URLs).
 *
 * @remarks
 * wm by natsumiworld <3 / ty: SennaFemboyNgawi
 *
 * @author Natsyn
 * @license MIT
 */
import { readFile } from "node:fs/promises";
import https from "node:https";
import qs from "node:querystring";

/**
 * A video quality entry inside Pinterest's `videos.video_list`.
 * @typedef {Object} PinterestVideoVariant
 * @property {string} url - Direct URL to the video file (usually mp4).
 */

/**
 * Minimal shape of `videos.video_list` used by this scraper.
 * Keys vary (e.g., "V_720P", "V_480P"), so we treat it as a string map.
 * @typedef {Object.<string, PinterestVideoVariant>} PinterestVideoList
 */

/**
 * Picks the best available video URL from a pin object (highest known quality first).
 *
 * @param {any} p - A pin-like object returned by Pinterest resources.
 * @returns {string|null} A direct video URL if found; otherwise `null`.
 */
function pickBestVideoUrl(p) {
	const list = p?.videos?.video_list;
	if (!list) {
		return null;
	}
	const preferred = [
		"V_1080P",
		"V_720P",
		"V_540P",
		"V_480P",
		"V_360P",
		"V_240P",
	];
	for (const k of preferred) {
		if (list[k]?.url) {
			return list[k].url;
		}
	}
	const any = Object.values(list).find((v) => v?.url);
	return any?.url || null;
}

/**
 * Picks the best available image URL from a pin object (largest first).
 *
 * @param {any} p - A pin-like object returned by Pinterest resources.
 * @returns {string|null} A direct image URL if found; otherwise `null`.
 */
function pickBestImageUrl(p) {
	return (
		p?.images?.orig?.url ||
		p?.images?.["736x"]?.url ||
		p?.images?.["564x"]?.url ||
		p?.images?.["474x"]?.url ||
		p?.images?.["236x"]?.url ||
		null
	);
}

function lensFind() {
	if (typeof Blob === "undefined" || typeof FormData === "undefined") {
		throw new Error(
			"Blob/FormData not found. Use Node 18+ or polyfill with 'undici'."
		);
	}
}

/**
 * A single search result returned by {@link Pinterest#search}.
 * @typedef {Object} PinterestSearchResult
 * @property {string} title - Pin title (may be empty on some pins; filtered by this implementation).
 * @property {string|number} id - Pin id.
 * @property {string|null} author - Username of the pinner if available.
 * @property {string|null} followers - Formatted follower count for the pinner (e.g. "12,345") if available.
 * @property {string} source - Public Pinterest URL for the pin.
 * @property {string|null} image - Best image URL if available.
 * @property {string|null} video - Best video URL if available.
 * @property {"image"|"video"} type - Media type chosen for the result.
 */

/**
 * Result returned by {@link Pinterest#download}.
 * @typedef {Object} PinterestDownloadInfo
 * @property {string|null} src - Direct media URL (image or video).
 * @property {"image"|"video"} type - The detected media type.
 * @property {string|null} description - Pin description (only available when pin id is detected).
 * @property {any|null} meta - Pinner metadata object when available.
 * @property {string} finalUrl - Resolved URL after redirects.
 * @property {string|null} pinId - Pin id if detected; otherwise `null` when fallback parsing is used.
 * @property {string=} note - Extra note when fallback HTML parsing is used.
 */

/**
 * Pinterest helper for searching pins and extracting a direct media URL (image/video).
 *
 * Notes:
 * - Uses a lightweight "session" (cookies + csrftoken) pulled from Pinterest homepage.
 * - Uses Pinterest resource endpoints for search and pin detail when possible.
 */
export class Pinterest {
	/**
	 * Creates a new Pinterest client instance.
	 * Initializes an HTTPS keep-alive agent and empty session fields.
	 */
	constructor() {
		/** @type {https.Agent} */
		this.agent = new https.Agent({ keepAlive: true });

		/** @type {string} */
		this.cookies = "";

		/** @type {string} */
		this.csrf = "";

		/** @type {boolean} */
		this.inited = false;
	}

	/**
	 * Initializes the session (cookies + csrftoken) by visiting Pinterest homepage once.
	 * Safe to call multiple times.
	 *
	 * @returns {Promise<void>}
	 */
	async init() {
		if (this.inited) {
			return;
		}

		const home = await fetch("https://www.pinterest.com/", {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
				Accept: "text/html,application/xhtml+xml",
			},
			redirect: "follow",
		});

		const raw = home.headers.getSetCookie?.() ?? [];
		const raw2 = raw.length
			? raw
			: home.headers.get("set-cookie")
				? [home.headers.get("set-cookie")]
				: [];

		const cookiePairs = raw2
			.flatMap((h) => String(h).split(/,(?=\s*\w+=)/g))
			.map((c) => c.split(";")[0])
			.filter(Boolean);

		this.cookies = cookiePairs.join("; ");
		this.csrf =
			(cookiePairs.find((c) => c.startsWith("csrftoken=")) || "").split(
				"="
			)[1] || "";

		this.inited = true;
	}

	/**
	 * Searches Pinterest pins by query using BaseSearchResource.
	 *
	 * @param {string} query - Search keyword(s).
	 * @returns {Promise<PinterestSearchResult[]>} Up to 25 search results in a simplified shape.
	 * @throws {Error} If Pinterest returns a non-OK response.
	 */
	async search(query) {
		await this.init();
		const source_url = `/search/pins/?q=${encodeURIComponent(query)}`;
		const data = {
			options: {
				query,
				field_set_key: "react_grid_pin",
				is_prefetch: false,
				page_size: 25,
			},
			context: {},
		};

		const body = qs.stringify({
			source_url,
			data: JSON.stringify(data),
		});

		const res = await fetch(
			"https://www.pinterest.com/resource/BaseSearchResource/get/",
			{
				method: "POST",
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
					Accept: "application/json, text/javascript, */*; q=0.01",
					"Content-Type":
						"application/x-www-form-urlencoded; charset=UTF-8",
					"X-CSRFToken": this.csrf,
					"X-Requested-With": "XMLHttpRequest",
					Origin: "https://www.pinterest.com",
					Referer: `https://www.pinterest.com${source_url}`,
					Cookie: this.cookies,
				},
				body,
				redirect: "follow",
			}
		);

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`Search failed: ${res.status} ${res.statusText} :: ${text.slice(0, 200)}`
			);
		}

		const json = await res.json();
		const results = json?.resource_response?.data?.results || [];

		return results
			.filter((a) => a?.title !== "")
			.map((a) => ({
				title: a?.title ?? "",
				id: a?.id,
				author: a?.pinner?.username ?? null,
				followers: a?.pinner?.follower_count
					? a.pinner.follower_count.toLocaleString()
					: null,
				source: `https://www.pinterest.com/pin/${a?.id}/`,
				image: pickBestImageUrl(a),
				video: pickBestVideoUrl(a),
				type: pickBestVideoUrl(a) ? "video" : "image",
			}));
	}

	/**
	 * Resolves shortlinks (e.g., pin.it) by following redirects and returning the final URL.
	 *
	 * @param {string} url - A Pinterest URL or shortlink.
	 * @returns {Promise<string>} The final resolved URL.
	 */
	async resolvePinUrl(url) {
		const r = await fetch(url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
			},
			redirect: "follow",
		});
		return r.url;
	}

	/**
	 * Extracts a numeric pin id from a Pinterest pin URL.
	 *
	 * @param {string} finalUrl - A resolved Pinterest URL (ideally containing `/pin/<id>`).
	 * @returns {string|null} Pin id if detected, otherwise `null`.
	 */
	extractPinId(finalUrl) {
		const m = String(finalUrl).match(/\/pin\/(\d+)/);
		return m?.[1] || null;
	}

	/**
	 * Fetches pin details by pin id using PinResource.
	 *
	 * @param {string} pinId - Pinterest pin id.
	 * @returns {Promise<any|null>} Raw pin object returned by Pinterest, or `null`.
	 * @throws {Error} If Pinterest returns a non-OK response.
	 */
	async getPinById(pinId) {
		await this.init();

		const source_url = `/pin/${pinId}/`;
		const data = {
			options: {
				id: pinId,
				field_set_key: "detailed",
			},
			context: {},
		};

		const body = qs.stringify({
			source_url,
			data: JSON.stringify(data),
		});

		const res = await fetch(
			"https://www.pinterest.com/resource/PinResource/get/",
			{
				method: "POST",
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
					Accept: "application/json, text/javascript, */*; q=0.01",
					"Content-Type":
						"application/x-www-form-urlencoded; charset=UTF-8",
					"X-CSRFToken": this.csrf,
					"X-Requested-With": "XMLHttpRequest",
					Origin: "https://www.pinterest.com",
					Referer: `https://www.pinterest.com${source_url}`,
					Cookie: this.cookies,
				},
				body,
			}
		);

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`PinResource failed: ${res.status} ${res.statusText} :: ${text.slice(0, 200)}`
			);
		}

		const json = await res.json();
		const p = json?.resource_response?.data || null;
		return p;
	}

	/**
	 * Resolves a Pinterest URL (or pin.it shortlink), then returns a direct media URL.
	 *
	 * Flow:
	 * 1) Resolve redirects to a final Pinterest URL.
	 * 2) Try extracting a pin id and fetching pin details via PinResource (preferred).
	 * 3) If pin id can't be detected, falls back to parsing the HTML for a media URL.
	 *
	 * @param {string} url - Pinterest pin URL or pin.it shortlink.
	 * @returns {Promise<PinterestDownloadInfo>} A structured object containing the direct media URL (src) and metadata.
	 */
	async download(url) {
		const finalUrl = await this.resolvePinUrl(url);
		const pinId = this.extractPinId(finalUrl);

		if (!pinId) {
			const pinResponse = await fetch(finalUrl, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
				},
			});
			const html = await pinResponse.text();
			const videoMatch = html.match(/https?:\/\/[^"'<>()\s]+\.mp4/gi);
			const jpgMatch = html.match(
				/<link[^>]+as="image"[^>]+href="([^"]+)"/i
			);
			const src =
				(videoMatch && videoMatch[0]) ||
				(jpgMatch && jpgMatch[1]) ||
				null;

			return {
				src,
				type: src?.includes(".mp4") ? "video" : "image",
				description: null,
				meta: null,
				finalUrl,
				pinId: null,
				note: "Fallback HTML parsing used (Pin ID not detected).",
			};
		}

		const pin = await this.getPinById(pinId);

		const videoUrl = pickBestVideoUrl(pin);
		const imageUrl = pickBestImageUrl(pin);
		const mediaUrl = videoUrl || imageUrl;

		return {
			src: mediaUrl,
			type: videoUrl ? "video" : "image",
			description: pin?.description ?? null,
			meta: pin?.pinner ?? pin?.origin_pinner ?? null,
			finalUrl,
			pinId,
		};
	}

	async lensFile(filePath, opt = {}) {
		lensFind();

		const filename = opt.filename ?? "pinterest.jpg";
		const crop = opt.crop ?? { x: 0, y: 0, w: 1, h: 1 };

		const buf = await readFile(filePath);
		const blob = new Blob([buf]);

		const form = new FormData();
		form.append("image", blob, filename);
		form.append("x", String(crop.x));
		form.append("y", String(crop.y));
		form.append("w", String(crop.w));
		form.append("h", String(crop.h));
		form.append("base_scheme", "https");

		const rsp = await fetch(
			"https://api.pinterest.com/v3/visual_search/extension/image/",
			{
				method: "PUT",
				body: form,
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
				},
			}
		);

		const json = await rsp.json().catch(() => null);

		if (
			rsp.status !== 200 ||
			!json ||
			json.status !== "success" ||
			!Array.isArray(json.data) ||
			json.data.length === 0
		) {
			const hint =
				json?.message ||
				json?.error ||
				`HTTP ${rsp.status} ${rsp.statusText}`;
			throw new Error(`Lens search failed: ${hint}`);
		}

		return json.data.map((it) => ({
			id: it.id ?? null,
			page: it.id ? `https://www.pinterest.com/pin/${it.id}/` : null,
			image:
				it.image_large_url ??
				it.image_medium_url ??
				it.image_square_url ??
				null,
			image_large: it.image_large_url ?? null,
			image_medium: it.image_medium_url ?? null,
			image_square: it.image_square_url ?? null,
			title: it.title && it.title.trim() ? it.title.trim() : null,
			description:
				it.description && it.description.trim()
					? it.description.trim()
					: null,
			link: it.link ?? it.tracked_link ?? null,
			domain: it.domain ?? null,
			is_video: Boolean(it.is_video),
			repin_count:
				typeof it.repin_count === "number" ? it.repin_count : null,
			created_at: it.created_at ?? null,
			is_uploaded:
				typeof it.is_uploaded === "boolean" ? it.is_uploaded : null,
		}));
	}
}
