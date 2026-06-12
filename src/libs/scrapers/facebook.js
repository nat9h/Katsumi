/**
 * @fileoverview Facebook scraper for videos, reels, image posts, and search.
 * No cookies or API keys needed — works on public content only.
 * @module scrapers/facebook
 */

import axios from "axios";

class Facebook {
    USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0",
    ];

    /** Pick a random User-Agent. */
    get UA() {
        return this.USER_AGENTS[
            Math.floor(Math.random() * this.USER_AGENTS.length)
        ];
    }

    VIDEO_HD_PATTERNS = [
        /hd_src:"(https?[^"]+)"/,
        /"hd_src":"(https?[^"]+)"/,
        /hd_src_no_ratelimit:"(https?[^"]+)"/,
        /"hd_src_no_ratelimit":"(https?[^"]+)"/,
        /browser_native_hd_url":"(https?[^"]+)"/,
        /playable_url_quality_hd":"(https?[^"]+)"/,
    ];

    VIDEO_SD_PATTERNS = [
        /sd_src:"(https?[^"]+)"/,
        /"sd_src":"(https?[^"]+)"/,
        /sd_src_no_ratelimit:"(https?[^"]+)"/,
        /"sd_src_no_ratelimit":"(https?[^"]+)"/,
        /browser_native_sd_url":"(https?[^"]+)"/,
        /playable_url":"(https?[^"]+)"/,
    ];

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
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
                String.fromCharCode(Number.parseInt(hex, 16)),
            )
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
     * @returns {{ hd: string|null, sd: string|null }}
     */
    extractVideo(html) {
        return {
            hd: this.matchFirst(html, this.VIDEO_HD_PATTERNS),
            sd: this.matchFirst(html, this.VIDEO_SD_PATTERNS),
        };
    }

    /**
     * Extract full post caption from embedded JSON data in page source.
     * @param {string} html
     * @returns {string|null}
     */
    extractCaption(html) {
        const msgMatch = html.match(
            /"message"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/,
        );
        if (msgMatch) {
            return this.decode(
                msgMatch[1]
                    .replace(/\\n/g, "\n")
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, "\\"),
            );
        }

        const actrsMatch = html.match(
            /"actrs_description"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/,
        );
        if (actrsMatch) {
            return this.decode(
                actrsMatch[1]
                    .replace(/\\n/g, "\n")
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, "\\"),
            );
        }

        const descMatch = html.match(
            /<meta\s+property="og:description"\s+content="([^"]+)"/i,
        );
        if (descMatch) {
            return this.decode(descMatch[1]);
        }

        return null;
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
     * Build Facebook session cookies from env.
     * @returns {string|null}
     */
    getCookies() {
        const cUser = process.env.FB_C_USER || "";
        const xs = process.env.FB_XS || "";
        if (!cUser || !xs) {
            return null;
        }
        return `c_user=${cUser}; xs=${xs}; presence=C%7B%22t3%22%3A%5B%5D%2C%22utc3%22%3A0%7D;`;
    }

    /**
     * Common request headers for Facebook.
     * @returns {object}
     */
    get requestHeaders() {
        return {
            "User-Agent": this.UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "max-age=0",
            "sec-ch-ua":
                '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="8"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
        };
    }

    /**
     * Extract video URLs from authenticated (React SPA) HTML.
     * Facebook serves video data in different JSON structures when logged in.
     * @param {string} html
     * @returns {{ hd: string|null, sd: string|null }}
     */
    extractVideoAuth(html) {
        let hd = null;
        let sd = null;

        const hdPatterns = [
            /"playable_url_quality_hd"\s*:\s*"(https?[^"]+)"/,
            /"browser_native_hd_url"\s*:\s*"(https?[^"]+)"/,
            /"hd_src"\s*:\s*"(https?[^"]+)"/,
        ];
        for (const re of hdPatterns) {
            const m = html.match(re);
            if (m) {
                hd = this.decode(m[1]);
                break;
            }
        }

        const sdPatterns = [
            /"playable_url"\s*:\s*"(https?[^"]+)"/,
            /"browser_native_sd_url"\s*:\s*"(https?[^"]+)"/,
            /"sd_src"\s*:\s*"(https?[^"]+)"/,
            /"progressive_url"\s*:\s*"(https?[^"]+)"/,
            /"video_url"\s*:\s*"(https?[^"]+)"/,
            /"base_url"\s*:\s*"(https?:\/\/video[^"]+)"/,
        ];
        for (const re of sdPatterns) {
            const m = html.match(re);
            if (m) {
                sd = this.decode(m[1]);
                break;
            }
        }

        return { hd, sd };
    }

    /**
     * Extract images from authenticated HTML (different JSON structure).
     * @param {string} html
     * @returns {string[]}
     */
    extractImagesAuth(html) {
        const seen = new Set();
        const images = [];

        const patterns = [
            /"uri"\s*:\s*"(https?:\\\/\\\/scontent[^"]+)"/g,
            /"url"\s*:\s*"(https?:\\\/\\\/scontent[^"]+\.jpg[^"]*)"/g,
            /"uri"\s*:\s*"(https?:\/\/scontent[^"]+)"/g,
            /"url"\s*:\s*"(https?:\/\/scontent[^"]+\.jpg[^"]*)"/g,
        ];

        for (const re of patterns) {
            for (const m of html.matchAll(re)) {
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
            if (images.length > 0) {
                break;
            }
        }

        return images;
    }

    /**
     * Download media from a public Facebook URL.
     * Strategy: try without cookies first, fallback with cookies if available.
     * @param {string} url - Facebook video, reel, or photo post URL.
     * @returns {Promise<object>}
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("Facebook URL is required.");
        }

        const normalizedUrl = this.normalize(url.trim());
        const headers = this.requestHeaders;

        const { data: html } = await axios.get(normalizedUrl, {
            headers,
            timeout: 15_000,
            maxRedirects: 5,
        });

        let title =
            this.extractCaption(html) ||
            (html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                html.match(/<title>([^<]+)<\/title>/i))?.[1] ||
            "";

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

        if (images.length > 0) {
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

        const cookies = this.getCookies();
        if (cookies) {
            const { data: authHtml } = await axios.get(normalizedUrl, {
                headers: { ...headers, Cookie: cookies },
                timeout: 15_000,
                maxRedirects: 5,
            });

            if (!title || title === "Facebook") {
                title =
                    this.extractCaption(authHtml) ||
                    (authHtml.match(
                        /<meta\s+property="og:title"\s+content="([^"]+)"/i,
                    ) || authHtml.match(/<title>([^<]+)<\/title>/i))?.[1] ||
                    "";
            }

            const authVideo = this.extractVideoAuth(authHtml);
            if (authVideo.sd || authVideo.hd) {
                return {
                    type: "video",
                    title: title ? this.decode(title) : "",
                    thumbnail: thumbnail ? this.decode(thumbnail) : "",
                    sd: authVideo.sd || "",
                    hd: authVideo.hd || "",
                    video: authVideo.hd || authVideo.sd,
                    images: [],
                };
            }

            images = this.extractImagesAuth(authHtml);
            if (images.length > 0) {
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

        if (thumbnail) {
            return {
                type: "image",
                title: title ? this.decode(title) : "",
                thumbnail: this.decode(thumbnail),
                sd: "",
                hd: "",
                video: "",
                images: [this.decode(thumbnail)],
            };
        }

        throw new Error(
            "Could not extract media. Post might be private or URL is invalid.",
        );
    }

    /**
     * Search Facebook videos/posts via Brave Search.
     * @param {string} query - Search query.
     * @param {object} [options]
     * @param {"video"|"post"|"page"|"all"} [options.type="video"] - Content type filter.
     * @param {number} [options.limit=10] - Max results to return.
     * @returns {Promise<Array<{ title: string, url: string, description: string, type: string }>>}
     */
    async search(query, { type = "video", limit = 10 } = {}) {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }

        const siteQuery = this.#buildSearchQuery(query.trim(), type);
        const html = await this.#fetchSearch(siteQuery);

        return this.#parseSearchResults(html, type, limit);
    }

    /**
     * Fetch search results with retry on 429.
     * @param {string} query
     * @param {number} [retries=2]
     * @returns {Promise<string>}
     */
    async #fetchSearch(query, retries = 2) {
        for (let i = 0; i <= retries; i++) {
            try {
                const { data } = await axios.get(
                    "https://search.brave.com/search",
                    {
                        params: { q: query, source: "web" },
                        headers: {
                            "User-Agent": this.UA,
                            Accept: "text/html,application/xhtml+xml",
                            "Accept-Language": "en-US,en;q=0.9",
                        },
                        timeout: 15_000,
                    },
                );
                return data;
            } catch (e) {
                if (e.response?.status === 429 && i < retries) {
                    await new Promise((r) => setTimeout(r, 3_000 * (i + 1)));
                    continue;
                }
                throw e;
            }
        }
    }

    /**
     * Build the search query with site filter.
     * @param {string} query
     * @param {string} type
     * @returns {string}
     */
    #buildSearchQuery(query, type) {
        switch (type) {
            case "video":
                return `site:facebook.com ${query} video`;
            case "post":
                return `site:facebook.com ${query}`;
            case "page":
                return `site:facebook.com ${query}`;
            default:
                return `site:facebook.com ${query}`;
        }
    }

    /**
     * Parse Brave Search HTML results.
     * @param {string} html
     * @param {string} type
     * @param {number} limit
     * @returns {Array<{ title: string, url: string, description: string, type: string }>}
     */
    #parseSearchResults(html, type, limit) {
        const results = [];
        const seen = new Set();

        const snippetRegex =
            /<div[^>]*class="snippet[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/(?:www\.)?facebook\.com[^"]+)"[^>]*>[\s\S]*?<\/a>[\s\S]*?<\/div>/g;

        let match;
        while ((match = snippetRegex.exec(html)) !== null) {
            const url = match[1];
            if (seen.has(url)) {
                continue;
            }
            seen.add(url);

            const block = match[0];
            const title = this.#extractSearchText(
                block.match(
                    /<span class="snippet-title"[^>]*>([\s\S]*?)<\/span>/,
                ),
            );
            const desc = this.#extractSearchText(
                block.match(
                    /<span class="snippet-description"[^>]*>([\s\S]*?)<\/span>/,
                ),
            );

            if (this.#matchesType(url, type)) {
                results.push({
                    title: title || this.#titleFromUrl(url),
                    url: this.#cleanSearchUrl(url),
                    description: desc || "",
                    type: this.#detectUrlType(url),
                });
            }
        }

        if (results.length === 0) {
            const hrefRegex =
                /href="(https?:\/\/(?:www\.)?facebook\.com\/[^"]+)"/g;
            while ((match = hrefRegex.exec(html)) !== null) {
                const url = match[1];
                if (seen.has(url)) {
                    continue;
                }
                if (url.includes("/policies/") || url.includes("/help/")) {
                    continue;
                }
                seen.add(url);

                if (this.#matchesType(url, type)) {
                    results.push({
                        title: this.#titleFromUrl(url),
                        url: this.#cleanSearchUrl(url),
                        description: "",
                        type: this.#detectUrlType(url),
                    });
                }
            }
        }

        return results.slice(0, limit);
    }

    /**
     * Check if URL matches the requested content type.
     * @param {string} url
     * @param {string} type
     * @returns {boolean}
     */
    #matchesType(url, type) {
        if (type === "all") {
            return true;
        }
        if (type === "video") {
            return (
                url.includes("/videos/") ||
                url.includes("/reel/") ||
                url.includes("/watch")
            );
        }
        if (type === "page") {
            return !url.includes("/videos/") && !url.includes("/reel/");
        }
        return true;
    }

    /**
     * Detect content type from URL.
     * @param {string} url
     * @returns {string}
     */
    #detectUrlType(url) {
        if (url.includes("/videos/") || url.includes("/watch")) {
            return "video";
        }
        if (url.includes("/reel/")) {
            return "reel";
        }
        if (url.includes("/posts/") || url.includes("/permalink/")) {
            return "post";
        }
        if (url.includes("/photos/")) {
            return "photo";
        }
        return "page";
    }

    /**
     * Generate a readable title from a Facebook URL.
     * @param {string} url
     * @returns {string}
     */
    #titleFromUrl(url) {
        try {
            const path = new URL(url).pathname;
            const parts = path.split("/").filter(Boolean);

            if (parts.includes("videos") && parts.length >= 3) {
                const idx = parts.indexOf("videos");
                const slug = parts[idx + 1] || parts[0];
                return this.#slugToTitle(slug);
            }

            if (parts.includes("reel") && parts.length >= 2) {
                return `${this.#slugToTitle(parts[0])} (Reel)`;
            }

            return this.#slugToTitle(parts[0] || "Facebook");
        } catch {
            return "Facebook";
        }
    }

    /**
     * Convert a URL slug to a readable title.
     * @param {string} slug
     * @returns {string}
     */
    #slugToTitle(slug) {
        if (/^\d+$/.test(slug)) {
            return `Facebook (${slug})`;
        }

        return slug
            .replace(/-/g, " ")
            .replace(/\./g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    /**
     * Remove tracking params from URL.
     * @param {string} url
     * @returns {string}
     */
    #cleanSearchUrl(url) {
        try {
            const u = new URL(url);
            for (const key of [...u.searchParams.keys()]) {
                if (!["v", "id"].includes(key)) {
                    u.searchParams.delete(key);
                }
            }
            return u.toString();
        } catch {
            return url;
        }
    }

    /**
     * Extract text content from a regex match, stripping HTML tags.
     * @param {RegExpMatchArray|null} match
     * @returns {string}
     */
    #extractSearchText(match) {
        if (!match?.[1]) {
            return "";
        }
        return match[1]
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/\s+/g, " ")
            .trim();
    }
}

export default new Facebook();
