/**
 * @fileoverview Booru image search — 7 sites, no login required.
 * @module scrapers/booru
 */

import axios from "axios";

export class Booru {
    static #UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    static #dapi = "/index.php?page=dapi&s=post&q=index&json=1&";
    static #postJson = "/post.json?";
    static #postsJson = "/posts.json?";

    static sites = Object.freeze({
        e621: {
            domain: "e621.net",
            path: Booru.#postsJson,
            nsfw: true,
            noPageZero: true,
        },
        e926: {
            domain: "e926.net",
            path: Booru.#postsJson,
            nsfw: false,
            noPageZero: true,
        },
        yandere: { domain: "yande.re", path: Booru.#postJson, nsfw: true },
        safebooru: {
            domain: "safebooru.org",
            path: Booru.#dapi,
            nsfw: false,
            paginate: "pid",
        },
        hypnohub: {
            domain: "hypnohub.net",
            path: Booru.#dapi,
            nsfw: true,
            paginate: "pid",
        },
        xbooru: {
            domain: "xbooru.com",
            path: Booru.#dapi,
            nsfw: true,
            paginate: "pid",
        },
        tbib: {
            domain: "tbib.org",
            path: Booru.#dapi,
            nsfw: false,
            paginate: "pid",
        },
    });

    #http;

    constructor({ timeout = 20_000 } = {}) {
        this.#http = axios.create({
            timeout,
            headers: {
                "User-Agent": Booru.#UA,
                Accept: "application/json, application/xml;q=0.9, */*;q=0.8",
            },
        });
    }

    #buildUrl(cfg, tags, limit, page) {
        const params = new URLSearchParams({ tags, limit: String(limit) });
        const p = cfg.noPageZero && page === 0 ? 1 : page;
        if (cfg.paginate) {
            params.set(cfg.paginate, String(p));
        } else {
            params.set("page", String(p));
        }
        return `https://${cfg.domain}${cfg.path}${params.toString()}`;
    }

    #unwrap(data) {
        if (Array.isArray(data)) {
            return data;
        }
        if (Array.isArray(data?.post)) {
            return data.post;
        }
        if (Array.isArray(data?.posts)) {
            return data.posts;
        }
        return [];
    }

    #mapPost(p) {
        const url = p.file_url || p.file?.url || null;
        if (!url) {
            return null;
        }
        const rawTags = p.tag_string || p.tags;
        return {
            id: p.id,
            url,
            preview:
                p.preview_file_url || p.preview_url || p.preview?.url || null,
            sample: p.sample_url || p.sample?.url || null,
            width: p.image_width || p.width || p.file?.width || 0,
            height: p.image_height || p.height || p.file?.height || 0,
            tags:
                typeof rawTags === "string"
                    ? rawTags.split(/\s+/).filter(Boolean)
                    : Array.isArray(rawTags)
                      ? rawTags
                      : Object.values(rawTags || {}).flat(),
            rating: p.rating,
            score: p.score?.total ?? p.score ?? 0,
            source: p.source || p.sources?.[0] || null,
        };
    }

    /**
     * Search a booru site for posts matching tags.
     * Falls back to safebooru if the requested site fails.
     * @param {string} tags - Space-separated tags (e.g. "cat_ears blue_hair")
     * @param {{ site?: string, limit?: number, page?: number, random?: boolean }} [opts]
     * @returns {Promise<object[]>}
     */
    async search(
        tags,
        { site = "safebooru", limit = 20, page = 0, random = true } = {},
    ) {
        const cfg = Booru.sites[site];
        if (!cfg) {
            throw new Error(
                `Unknown booru site: ${site}. Options: ${Object.keys(Booru.sites).join(", ")}`,
            );
        }
        if (!tags?.trim()) {
            throw new Error("Tags are required.");
        }

        const fallback = site !== "safebooru" ? "safebooru" : null;
        const tries = fallback ? [site, fallback] : [site];

        for (const s of tries) {
            try {
                const c = Booru.sites[s];
                const url = this.#buildUrl(c, tags, limit, page);
                const { data } = await this.#http.get(url);
                const posts = this.#unwrap(data)
                    .map((p) => this.#mapPost(p))
                    .filter(Boolean);

                if (random && posts.length > 1) {
                    for (let i = posts.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [posts[i], posts[j]] = [posts[j], posts[i]];
                    }
                }

                if (posts.length > 0) {
                    return posts;
                }
            } catch (err) {
                if (s === tries[tries.length - 1]) {
                    throw err;
                }
            }
        }

        return [];
    }

    async random(tags, opts = {}) {
        const results = await this.search(tags, { ...opts, random: true });
        return results[0] || null;
    }
}

let _shared;
export function getBooru(opts) {
    if (!_shared) {
        _shared = new Booru(opts);
    }
    return _shared;
}
