/**
 * @fileoverview Facebook scraper for videos, reels, and image posts.
 * No cookies or API keys needed — works on public content only.
 * @module scrapers/facebook
 */

import axios from "axios";

class Facebook {
    UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    HEADERS = {
        "User-Agent": this.UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "sec-fetch-mode": "navigate",
    };

    /**
     * Decode HTML/JSON entities from extracted strings.
     * @param {string} str
     * @returns {string}
     */
    decode(str) {
        return str
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
                String.fromCodePoint(Number.parseInt(hex, 16)),
            )
            .replace(/\\u0025/g, "%")
            .replace(/\\\//g, "/");
    }

    /**
     * Normalize any Facebook URL variant to www.facebook.com.
     * @param {string} url
     * @returns {string}
     */
    normalize(url) {
        return url
            .replace("m.facebook.com", "www.facebook.com")
            .replace("mbasic.facebook.com", "www.facebook.com")
            .replace("web.facebook.com", "www.facebook.com");
    }

    /**
     * Match the first successful regex from a list against HTML.
     * @param {string} html
     * @param {RegExp[]} patterns
     * @returns {string|null}
     */
    matchFirst(html, patterns) {
        for (const re of patterns) {
            const m = html.match(re);
            if (m) {
                return this.decode(m[1]);
            }
        }
        return null;
    }

    /**
     * Extract video SD/HD URLs from page source.
     * @param {string} html
     * @returns {{ sd: string|null, hd: string|null }}
     */
    extractVideo(html) {
        const hd = this.matchFirst(html, [
            /hd_src:"(https?[^"]+)"/,
            /"hd_src":"(https?[^"]+)"/,
            /hd_src_no_ratelimit:"(https?[^"]+)"/,
            /"hd_src_no_ratelimit":"(https?[^"]+)"/,
            /browser_native_hd_url":"(https?[^"]+)"/,
            /playable_url_quality_hd":"(https?[^"]+)"/,
        ]);

        const sd = this.matchFirst(html, [
            /sd_src:"(https?[^"]+)"/,
            /"sd_src":"(https?[^"]+)"/,
            /sd_src_no_ratelimit:"(https?[^"]+)"/,
            /"sd_src_no_ratelimit":"(https?[^"]+)"/,
            /browser_native_sd_url":"(https?[^"]+)"/,
            /playable_url":"(https?[^"]+)"/,
        ]);

        return { sd, hd };
    }

    /**
     * Extract unique post images from page source.
     * Filters for t39.30808-6 (post photos) and deduplicates by filename.
     * @param {string} html
     * @returns {string[]}
     */
    extractImages(html) {
        const seen = new Set();
        const images = [];

        // Escaped scontent URIs in JSON payloads
        const escaped = [
            ...html.matchAll(
                /"uri":"(https:\\\/\\\/scontent[^"]+?\.jpg[^"]*)"/g,
            ),
        ];

        for (const m of escaped) {
            const url = m[1].replace(/\\\//g, "/");
            if (!url.includes("/t39.30808-6/")) {
                continue;
            }
            const key = url.match(/\/(\d+_\d+_\d+_n\.jpg)/)?.[1] || url;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            images.push(url);
        }

        // Fallback: unescaped scontent URLs
        if (images.length === 0) {
            const raw = [
                ...html.matchAll(/"(https:\/\/scontent[^"]+?\.jpg[^"]*)"/g),
            ];
            for (const m of raw) {
                const url = m[1];
                if (!url.includes("/t39.30808-6/")) {
                    continue;
                }
                const key = url.match(/\/(\d+_\d+_\d+_n\.jpg)/)?.[1] || url;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                images.push(url);
            }
        }

        return images;
    }

    /**
     * Download media from a public Facebook URL.
     * Supports videos, reels, and photo posts (single & multi-image).
     * @param {string} url - Facebook video, reel, or photo post URL.
     * @returns {Promise<object>}
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("Facebook URL is required.");
        }

        const { data: html } = await axios.get(this.normalize(url.trim()), {
            headers: this.HEADERS,
            timeout: 15_000,
            maxRedirects: 5,
        });

        const title = (html.match(
            /<meta\s+property="og:title"\s+content="([^"]+)"/i,
        ) || html.match(/<title>([^<]+)<\/title>/i))?.[1];

        const thumbnail = html.match(
            /<meta\s+property="og:image"\s+content="([^"]+)"/i,
        )?.[1];

        const { sd, hd } = this.extractVideo(html);

        if (sd || hd) {
            return {
                type: "video",
                title: title ? this.decode(title) : "",
                thumbnail: thumbnail ? this.decode(thumbnail) : "",
                sd: sd || "",
                hd: hd || "",
                video: hd || sd,
                images: [],
            };
        }

        let images = this.extractImages(html);

        if (images.length === 0 && thumbnail) {
            images = [this.decode(thumbnail)];
        }

        if (images.length === 0) {
            throw new Error(
                "Could not extract media. Post might be private or URL is invalid.",
            );
        }

        return {
            type: "image",
            title: title ? this.decode(title) : "",
            thumbnail: thumbnail ? this.decode(thumbnail) : "",
            sd: "",
            hd: "",
            video: "",
            images,
        };
    }
}

export default new Facebook();
