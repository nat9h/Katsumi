/**
 * @fileoverview Genius lyrics scraper (no API key needed).
 * @module scrapers/genius
 */

import axios from "axios";

export class Genius {
    constructor({ timeout = 15_000 } = {}) {
        this.http = axios.create({
            timeout,
            headers: {
                "user-agent":
                    "Mozilla/5.0 (Linux; Android 16; NX729J) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.34 Mobile Safari/537.36",
                accept: "application/json, text/html",
            },
        });
    }

    /**
     * @param {string} query
     * @param {{ limit?: number }} [opts]
     * @returns {Promise<Array<{ title: string, artist: string, url: string, thumbnail: string|null, id: number }>>}
     */
    async search(query, { limit = 10 } = {}) {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }

        const { data } = await this.http.get(
            "https://genius.com/api/search/multi",
            {
                params: { q: query },
            },
        );

        const sections = data?.response?.sections || [];
        const songSection = sections.find((s) => s.type === "song");
        if (!songSection?.hits?.length) {
            return [];
        }

        return songSection.hits.slice(0, limit).map((hit) => {
            const song = hit.result;
            return {
                title: song.title || "Unknown",
                artist: song.primary_artist?.name || "Unknown",
                url: song.url || null,
                thumbnail: song.song_art_image_thumbnail_url || null,
                id: song.id,
            };
        });
    }

    /**
     * @param {string} url - Full Genius song URL
     * @returns {Promise<string>}
     */
    async lyrics(url) {
        const { data: html } = await this.http.get(url, {
            headers: { accept: "text/html" },
        });

        const parts = html.split(/data-lyrics-container="true"/);
        if (parts.length < 2) {
            throw new Error("Could not extract lyrics from page.");
        }

        const containers = [];
        for (let i = 1; i < parts.length; i++) {
            const startIdx = parts[i].indexOf(">");
            if (startIdx === -1) {
                continue;
            }
            const content = parts[i].slice(startIdx + 1);
            let depth = 1;
            let pos = 0;
            while (depth > 0 && pos < content.length) {
                const openDiv = content.indexOf("<div", pos);
                const closeDiv = content.indexOf("</div>", pos);
                if (closeDiv === -1) {
                    break;
                }
                if (openDiv !== -1 && openDiv < closeDiv) {
                    depth++;
                    pos = openDiv + 4;
                } else {
                    depth--;
                    if (depth === 0) {
                        containers.push(content.slice(0, closeDiv));
                    }
                    pos = closeDiv + 6;
                }
            }
        }

        if (!containers.length) {
            throw new Error("Could not extract lyrics from page.");
        }

        return this.#parse(containers.join("\n\n"));
    }

    #parse(raw) {
        const cleaned = raw
            .replace(/<a[^>]*class="[^"]*ReferentFragment[^"]*"[^>]*>/gi, "")
            .replace(/<\/a>/gi, "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<div[^>]*Translations?[^<]*<\/div>/gi, "")
            .replace(/<div[^>]*inread[^>]*>[\s\S]*?<\/div>/gi, "");

        const text = cleaned
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        const stripped = text.replace(/^Translations?[^\n[]+/i, "").trim();

        return stripped
            .replace(/\n?\[/g, "\n\n[")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }
}

export default Genius;

/** Cached singleton */
let _shared;
export function getGenius(opts) {
    if (!_shared) {
        _shared = new Genius(opts);
    }
    return _shared;
}
