/**
 * @fileoverview Pixiv scraper — search artworks and fetch metadata + images.
 * No login required. Uses Pixiv's public AJAX endpoints. Images must be fetched
 * with a Pixiv referer to bypass i.pximg.net's hotlink protection.
 * @module scrapers/pixiv
 */

/**
 * Strip Pixiv's HTML formatting from a description field.
 * Descriptions come as HTML fragments with <br> and inline anchor tags.
 */
function cleanDescription(html) {
    if (!html) {
        return "";
    }
    return String(html)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<a[^>]*>([^<]*)<\/a>/gi, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

class Pixiv {
    #ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    #base = "https://www.pixiv.net";

    /**
     * Extract artwork ID from a Pixiv URL. Supports /artworks/{id},
     * /en/artworks/{id}, and legacy member_illust.php?illust_id={id}.
     * @param {string} input
     * @returns {string|null}
     */
    extractId(input) {
        if (!input) {
            return null;
        }
        const match =
            String(input).match(/pixiv\.net\/(?:en\/)?artworks\/(\d+)/i) ||
            String(input).match(/illust_id=(\d+)/i);
        return match?.[1] || null;
    }

    #headers(extra = {}) {
        return {
            "User-Agent": this.#ua,
            Accept: "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: `${this.#base}/`,
            ...extra,
        };
    }

    /**
     * Search artworks by keyword.
     * @param {string} query
     * @param {object} [options]
     * @param {number} [options.page=1]
     * @param {number} [options.limit=30] - Max items to return (Pixiv returns up to 60/page).
     * @param {"safe"|"r18"|"all"} [options.mode="safe"] - Content rating filter.
     * @param {"date_d"|"date"|"popular_d"} [options.order="date_d"] - Sort order.
     * @param {"all"|"illust"|"manga"} [options.type="all"]
     * @returns {Promise<Array<{id: string, title: string, url: string, thumbnail: string, author: {id: string, name: string}, tags: string[], width: number, height: number, pageCount: number, createDate: string, aiGenerated: boolean}>>}
     */
    async search(query, options = {}) {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }

        const {
            page = 1,
            limit = 30,
            mode = "safe",
            order = "date_d",
            type = "all",
        } = options;

        const params = new URLSearchParams({
            word: query,
            order,
            mode,
            p: String(page),
            s_mode: "s_tag",
            type,
            lang: "en",
        });

        const url = `${this.#base}/ajax/search/artworks/${encodeURIComponent(query)}?${params}`;
        const res = await fetch(url, { headers: this.#headers() });

        if (!res.ok) {
            throw new Error(`Pixiv search failed: HTTP ${res.status}`);
        }

        const json = await res.json();
        if (json.error) {
            throw new Error(`Pixiv error: ${json.message || "unknown"}`);
        }

        const list =
            json.body?.illustManga?.data ||
            json.body?.illust?.data ||
            json.body?.manga?.data ||
            [];

        return list
            .filter((item) => item.id && item.title)
            .slice(0, limit)
            .map((item) => ({
                id: item.id,
                title: item.title,
                url: `${this.#base}/en/artworks/${item.id}`,
                thumbnail: item.url,
                author: {
                    id: item.userId,
                    name: item.userName,
                },
                tags: item.tags || [],
                width: item.width,
                height: item.height,
                pageCount: item.pageCount || 1,
                createDate: item.createDate,
                aiGenerated: item.aiType === 2,
            }));
    }

    /**
     * Fetch full artwork detail: description, author, image URLs.
     * @param {string} illustId
     * @returns {Promise<{id: string, title: string, description: string, author: {id: string, name: string, account: string}, tags: string[], url: string, urls: {mini: string, thumb: string, small: string, regular: string, original: string}, pageCount: number, width: number, height: number, viewCount: number, bookmarkCount: number, likeCount: number, createDate: string, aiGenerated: boolean}>}
     */
    async getIllust(illustId) {
        if (!illustId) {
            throw new Error("Illust ID is required.");
        }

        const res = await fetch(
            `${this.#base}/ajax/illust/${illustId}?lang=en`,
            { headers: this.#headers() },
        );

        if (!res.ok) {
            throw new Error(`Pixiv detail failed: HTTP ${res.status}`);
        }

        const json = await res.json();
        if (json.error || !json.body) {
            throw new Error(`Pixiv error: ${json.message || "not found"}`);
        }

        const d = json.body;
        return {
            id: d.illustId || d.id,
            title: d.illustTitle || d.title,
            description: cleanDescription(d.illustComment || d.description),
            author: {
                id: d.userId,
                name: d.userName,
                account: d.userAccount,
            },
            tags: (d.tags?.tags || []).map((t) => t.tag),
            url: `${this.#base}/en/artworks/${d.illustId || d.id}`,
            urls: d.urls || {},
            pageCount: d.pageCount || 1,
            width: d.width,
            height: d.height,
            viewCount: d.viewCount || 0,
            bookmarkCount: d.bookmarkCount || 0,
            likeCount: d.likeCount || 0,
            createDate: d.createDate,
            aiGenerated: d.aiType === 2,
        };
    }

    /**
     * Fetch all pages of a multi-page artwork.
     * @param {string} illustId
     * @returns {Promise<Array<{urls: {thumb_mini: string, small: string, regular: string, original: string}, width: number, height: number}>>}
     */
    async getPages(illustId) {
        const res = await fetch(
            `${this.#base}/ajax/illust/${illustId}/pages?lang=en`,
            { headers: this.#headers() },
        );
        if (!res.ok) {
            throw new Error(`Pixiv pages failed: HTTP ${res.status}`);
        }
        const json = await res.json();
        return json.body || [];
    }

    /**
     * Download an image from i.pximg.net (requires Pixiv referer).
     * @param {string} imageUrl
     * @returns {Promise<Buffer>}
     */
    async fetchImage(imageUrl) {
        if (!imageUrl) {
            throw new Error("Image URL is required.");
        }
        const res = await fetch(imageUrl, {
            headers: {
                "User-Agent": this.#ua,
                Referer: `${this.#base}/`,
            },
        });
        if (!res.ok) {
            throw new Error(`Image fetch failed: HTTP ${res.status}`);
        }
        return Buffer.from(await res.arrayBuffer());
    }

    /**
     * High-level convenience: search by query, then hydrate the top result
     * with full metadata + image buffer. Ideal for a single-shot command.
     * @param {string} query
     * @param {object} [options]
     * @param {number} [options.index=0] - Which search result to fetch (0-based).
     * @param {"regular"|"original"|"small"} [options.quality="regular"]
     * @param {"safe"|"r18"|"all"} [options.mode="safe"]
     * @returns {Promise<{buffer: Buffer, mime: string, meta: object}>}
     */
    async searchAndFetch(query, options = {}) {
        const {
            index = 0,
            quality = "regular",
            mode = "safe",
            ...rest
        } = options;

        const results = await this.search(query, {
            mode,
            limit: index + 1,
            ...rest,
        });
        if (!results.length) {
            throw new Error(`No Pixiv results for "${query}".`);
        }

        const pick = results[Math.min(index, results.length - 1)];
        const detail = await this.getIllust(pick.id);
        const imageUrl =
            detail.urls[quality] ||
            detail.urls.regular ||
            detail.urls.original ||
            pick.thumbnail;
        const buffer = await this.fetchImage(imageUrl);

        return {
            buffer,
            mime: "image/jpeg",
            meta: {
                id: detail.id,
                title: detail.title,
                description: detail.description,
                author: detail.author,
                tags: detail.tags,
                url: detail.url,
                imageUrl,
                pageCount: detail.pageCount,
                createDate: detail.createDate,
                aiGenerated: detail.aiGenerated,
            },
        };
    }
}

export default new Pixiv();
export { Pixiv };
