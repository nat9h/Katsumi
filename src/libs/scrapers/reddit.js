/**
 * @fileoverview Reddit downloader via public .json API.
 * Requires cookies/reddit.txt for authenticated access.
 * @module scrapers/reddit
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import axios from "axios";

class Reddit {
    #ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    /**
     * Load Reddit cookies from cookies/reddit.txt.
     * @returns {string}
     */
    getCookies() {
        try {
            return readFileSync(
                join(process.cwd(), "cookies", "reddit.txt"),
                "utf8",
            ).trim();
        } catch {
            throw new Error(
                "Reddit cookies not found. Save session cookies to cookies/reddit.txt.",
            );
        }
    }

    /**
     * Get standard headers for Reddit API requests.
     * @param {string} cookies
     * @param {string} [referer]
     * @returns {object}
     */
    #headers(cookies, referer = "https://www.reddit.com/") {
        return {
            "User-Agent": this.#ua,
            Cookie: cookies,
            Referer: referer,
        };
    }

    /**
     * Resolve a Reddit shortlink (/s/...) to its full URL.
     * @param {string} url
     * @param {string} cookies
     * @returns {Promise<string>}
     */
    async resolveShortlink(url, cookies) {
        try {
            const r = await axios.get(url, {
                headers: this.#headers(cookies),
                maxRedirects: 0,
                validateStatus: () => true,
                timeout: 15_000,
            });
            return r.headers?.location || url;
        } catch {
            return url;
        }
    }

    /**
     * Extract post ID and build the .json API URL.
     * @param {string} url - Reddit post URL
     * @returns {string|null}
     */
    extractPostUrl(url) {
        const clean = url.trim().split("?")[0].replace(/\/$/, "");
        if (/\/comments\//.test(clean)) {
            return clean;
        }
        return null;
    }

    /**
     * Unescape HTML entities in Reddit data.
     * @param {string} s
     * @returns {string}
     */
    #unescape(s) {
        return s
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }

    /**
     * Parse media from a Reddit post.
     * @param {object} d - post.data
     * @returns {Array<{type: string, url: string, audioUrl?: string, width?: number, height?: number}>}
     */
    #parseMedia(d) {
        const media = [];

        const rv =
            d.media?.reddit_video ||
            d.secure_media?.reddit_video ||
            d.preview?.reddit_video_preview;
        if (rv?.fallback_url) {
            const videoUrl = rv.fallback_url.split("?")[0];
            const id = videoUrl.match(/v\.redd\.it\/([^/]+)/)?.[1];
            media.push({
                type: "video",
                url: videoUrl,
                audioUrl: id
                    ? `https://v.redd.it/${id}/CMAF_AUDIO_128.mp4`
                    : null,
                width: rv.width || 0,
                height: rv.height || 0,
                duration: rv.duration || 0,
            });
        }

        if (d.gallery_data?.items?.length && d.media_metadata) {
            for (const item of d.gallery_data.items) {
                const meta = d.media_metadata[item.media_id];
                if (!meta) {
                    continue;
                }
                if (meta.e === "Image") {
                    media.push({
                        type: "image",
                        url: this.#unescape(meta.s.u),
                    });
                } else if (meta.e === "AnimatedImage") {
                    media.push({
                        type: "image",
                        url: this.#unescape(meta.s.gif || meta.s.u),
                    });
                }
            }
        }

        if (!media.length && d.preview?.images?.length) {
            const src = d.preview.images[0].source;
            media.push({
                type: "image",
                url: this.#unescape(src.url),
            });
        }

        return media;
    }

    /**
     * Download a Reddit post by URL.
     * @param {string} url - Reddit post URL (full or shortlink)
     * @returns {Promise<{title: string, author: string, subreddit: string, stats: object, media: Array}>}
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("Reddit URL is required.");
        }

        const cookies = this.getCookies();
        let postUrl = url.trim();

        if (/\/s\//.test(postUrl)) {
            postUrl = await this.resolveShortlink(postUrl, cookies);
        }

        const clean = postUrl.split("?")[0].replace(/\/$/, "");
        if (!/\/comments\//.test(clean)) {
            throw new Error(
                "Invalid Reddit URL. Supported: /r/subreddit/comments/... or shortlinks /s/...",
            );
        }

        const jsonUrl = `${clean}.json?raw_json=1`;
        const { data } = await axios.get(jsonUrl, {
            headers: this.#headers(cookies),
            timeout: 15_000,
        });

        const post = data?.[0]?.data?.children?.[0]?.data;
        if (!post) {
            throw new Error("Post not found or is private.");
        }

        const media = this.#parseMedia(post);
        if (!media.length) {
            throw new Error("No downloadable media found in this post.");
        }

        return {
            title: post.title || "",
            author: post.author || "",
            subreddit: post.subreddit_name_prefixed || "",
            stats: {
                upvotes: post.ups || 0,
                comments: post.num_comments || 0,
                ratio: post.upvote_ratio || 0,
            },
            media,
        };
    }

    /**
     * Download a URL as a Buffer.
     * @param {string} url
     * @returns {Promise<Buffer>}
     */
    async downloadBuffer(url) {
        const { data } = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 60_000,
            headers: this.#headers(this.getCookies()),
        });
        return Buffer.from(data);
    }
}

export default new Reddit();
