/**
 * @fileoverview Pinterest scraper — search, download, and visual search (Lens).
 * No login required. Uses guest session cookies from pinterest.com.
 * @module scrapers/pinterest
 */

import { unlink, writeFile } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import qs from "node:querystring";

/**
 * Pick the highest quality video URL from a pin object.
 * @param {object} pin
 * @returns {string|null}
 */
function bestVideo(pin) {
    const list = pin?.videos?.video_list;
    if (!list) {
        return null;
    }
    for (const key of [
        "V_1080P",
        "V_720P",
        "V_540P",
        "V_480P",
        "V_360P",
        "V_240P",
    ]) {
        if (list[key]?.url) {
            return list[key].url;
        }
    }
    return Object.values(list).find((v) => v?.url)?.url || null;
}

/**
 * Pick the highest resolution image URL from a pin object.
 * @param {object} pin
 * @returns {string|null}
 */
function bestImage(pin) {
    return (
        pin?.images?.orig?.url ||
        pin?.images?.["736x"]?.url ||
        pin?.images?.["564x"]?.url ||
        pin?.images?.["474x"]?.url ||
        pin?.images?.["236x"]?.url ||
        null
    );
}

class Pinterest {
    UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    agent = new https.Agent({ keepAlive: true });
    cookies = "";
    csrf = "";
    ready = false;

    /**
     * Initialize guest session (cookies + CSRF token) from Pinterest homepage.
     * Safe to call multiple times — only runs once.
     */
    async init() {
        if (this.ready) {
            return;
        }

        const res = await fetch("https://www.pinterest.com/", {
            headers: { "User-Agent": this.UA, Accept: "text/html" },
            redirect: "follow",
        });

        const raw = res.headers.getSetCookie?.() ?? [];
        const fallback = raw.length
            ? raw
            : res.headers.get("set-cookie")
              ? [res.headers.get("set-cookie")]
              : [];

        const pairs = fallback
            .flatMap((h) => String(h).split(/,(?=\s*\w+=)/g))
            .map((c) => c.split(";")[0])
            .filter(Boolean);

        this.cookies = pairs.join("; ");
        this.csrf =
            (pairs.find((c) => c.startsWith("csrftoken=")) || "").split(
                "=",
            )[1] || "";
        this.ready = true;
    }

    /**
     * Build common headers for Pinterest resource requests.
     * @param {string} referer
     * @returns {object}
     */
    headers(referer) {
        return {
            "User-Agent": this.UA,
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-CSRFToken": this.csrf,
            "X-Requested-With": "XMLHttpRequest",
            Origin: "https://www.pinterest.com",
            Referer: referer,
            Cookie: this.cookies,
        };
    }

    /**
     * Search pins by keyword.
     * @param {string} query
     * @param {number} [limit=25]
     * @returns {Promise<Array>}
     */
    async search(query, limit = 25) {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }
        await this.init();

        const sourcePath = `/search/pins/?q=${encodeURIComponent(query)}`;
        const body = qs.stringify({
            source_url: sourcePath,
            data: JSON.stringify({
                options: {
                    query,
                    field_set_key: "react_grid_pin",
                    is_prefetch: false,
                    page_size: limit,
                },
                context: {},
            }),
        });

        const res = await fetch(
            "https://www.pinterest.com/resource/BaseSearchResource/get/",
            {
                method: "POST",
                headers: this.headers(`https://www.pinterest.com${sourcePath}`),
                body,
                redirect: "follow",
            },
        );

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(
                `Pinterest search failed (${res.status}): ${text.slice(0, 200)}`,
            );
        }

        const json = await res.json();
        const results = json?.resource_response?.data?.results || [];

        return results
            .filter((pin) => pin?.id)
            .map((pin) => ({
                id: pin.id,
                title: pin.title || "",
                author: pin.pinner?.username || null,
                url: `https://www.pinterest.com/pin/${pin.id}/`,
                image: bestImage(pin),
                video: bestVideo(pin),
                type: bestVideo(pin) ? "video" : "image",
            }));
    }

    /**
     * Resolve a short URL (pin.it) to a full Pinterest URL.
     * Manually follows redirect hops to catch /pin/<id> in Location headers.
     * @param {string} url
     * @returns {Promise<string>}
     */
    async resolveUrl(url) {
        let current = url;

        for (let i = 0; i < 6; i++) {
            const res = await fetch(current, {
                headers: { "User-Agent": this.UA },
                redirect: "manual",
            });
            const location = res.headers.get("location");
            if (!location) {
                return current;
            }
            if (/\/pin\/\d+/.test(location)) {
                return location;
            }
            current = location;
        }

        const res = await fetch(url, {
            headers: { "User-Agent": this.UA },
            redirect: "follow",
        });
        return res.url;
    }

    /**
     * Extract numeric pin ID from a Pinterest URL.
     * @param {string} url
     * @returns {string|null}
     */
    extractId(url) {
        return String(url).match(/\/pin\/(\d+)/)?.[1] || null;
    }

    /**
     * Fetch detailed pin data by ID using PinResource.
     * @param {string} pinId
     * @returns {Promise<object|null>}
     */
    async getPin(pinId) {
        await this.init();

        const sourcePath = `/pin/${pinId}/`;
        const body = qs.stringify({
            source_url: sourcePath,
            data: JSON.stringify({
                options: { id: pinId, field_set_key: "detailed" },
                context: {},
            }),
        });

        const res = await fetch(
            "https://www.pinterest.com/resource/PinResource/get/",
            {
                method: "POST",
                headers: this.headers(`https://www.pinterest.com${sourcePath}`),
                body,
            },
        );

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(
                `PinResource failed (${res.status}): ${text.slice(0, 200)}`,
            );
        }

        const json = await res.json();
        return json?.resource_response?.data || null;
    }

    /**
     * Download media from a Pinterest URL (supports pin.it and full URLs).
     * @param {string} url
     * @returns {Promise<object>}
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("Pinterest URL is required.");
        }

        const resolved = await this.resolveUrl(url.trim());
        const pinId = this.extractId(resolved);

        if (!pinId) {
            const res = await fetch(resolved, {
                headers: { "User-Agent": this.UA },
            });
            const html = await res.text();

            const videoMatch = html.match(/https?:\/\/[^"'<>()\s]+\.mp4/gi);
            const imageMatch = html.match(
                /<link[^>]+as="image"[^>]+href="([^"]+)"/i,
            );
            const src = videoMatch?.[0] || imageMatch?.[1] || null;

            return {
                src,
                type: src?.includes(".mp4") ? "video" : "image",
                description: null,
                author: null,
                pinId: null,
                resolvedUrl: resolved,
            };
        }

        const pin = await this.getPin(pinId);
        const video = bestVideo(pin);
        const image = bestImage(pin);

        return {
            src: video || image,
            type: video ? "video" : "image",
            description: pin?.description || null,
            author: pin?.pinner?.username || null,
            pinId,
            resolvedUrl: resolved,
        };
    }

    /**
     * Visual search (Pinterest Lens) using an image buffer.
     * Finds visually similar pins.
     * @param {Buffer} buffer - Image buffer.
     * @param {object} [options]
     * @param {string} [options.filename="image.jpg"]
     * @param {{x: number, y: number, w: number, h: number}} [options.crop]
     * @returns {Promise<Array>}
     */
    async lens(buffer, options = {}) {
        const { filename = "image.jpg", crop = { x: 0, y: 0, w: 1, h: 1 } } =
            options;

        const tmp = join(tmpdir(), `pin_lens_${Date.now()}.jpg`);
        try {
            await writeFile(tmp, buffer);
            const blob = new Blob([buffer]);

            const form = new FormData();
            form.append("image", blob, filename);
            form.append("x", String(crop.x));
            form.append("y", String(crop.y));
            form.append("w", String(crop.w));
            form.append("h", String(crop.h));
            form.append("base_scheme", "https");

            const res = await fetch(
                "https://api.pinterest.com/v3/visual_search/extension/image/",
                {
                    method: "PUT",
                    body: form,
                    headers: { "User-Agent": this.UA },
                },
            );

            const json = await res.json().catch(() => null);

            if (
                res.status !== 200 ||
                json?.status !== "success" ||
                !Array.isArray(json.data) ||
                json.data.length === 0
            ) {
                const hint =
                    json?.message || json?.error || `HTTP ${res.status}`;
                throw new Error(`Pinterest Lens failed: ${hint}`);
            }

            return json.data.map((item) => ({
                id: item.id || null,
                url: item.id
                    ? `https://www.pinterest.com/pin/${item.id}/`
                    : null,
                image:
                    item.image_large_url ||
                    item.image_medium_url ||
                    item.image_square_url ||
                    null,
                title: item.title?.trim() || null,
                description: item.description?.trim() || null,
                link: item.link || item.tracked_link || null,
                domain: item.domain || null,
                isVideo: Boolean(item.is_video),
            }));
        } finally {
            await unlink(tmp).catch(() => {});
        }
    }
}

export default new Pinterest();
