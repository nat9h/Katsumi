/**
 * @fileoverview SoundCloud search + download via api-v2.soundcloud.com.
 * Scrapes client_id from soundcloud.com JS assets — no API key needed.
 * @module scrapers/soundcloud
 */

import axios from "axios";

export class SoundCloud {
    static #API = "https://api-v2.soundcloud.com";
    static #SITE = "https://soundcloud.com";

    #clientId = null;
    #clientIdExpiresAt = 0;
    #http;

    constructor({ timeout = 30_000 } = {}) {
        this.#http = axios.create({
            timeout,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                Accept: "application/json, text/javascript, */*; q=0.1",
                Referer: `${SoundCloud.#SITE}/`,
                Origin: SoundCloud.#SITE,
            },
        });
    }

    async #getClientId() {
        if (this.#clientId && Date.now() < this.#clientIdExpiresAt) {
            return this.#clientId;
        }

        const { data: html } = await this.#http.get(SoundCloud.#SITE, {
            headers: { Accept: "text/html" },
        });

        const scripts = [
            ...html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g),
        ].map((m) => m[1]);

        for (const src of scripts.reverse()) {
            const { data: js } = await this.#http
                .get(src, { headers: { Accept: "*/*" } })
                .catch(() => ({ data: "" }));
            const match =
                js.match(/[,{]client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/) ||
                js.match(/client_id:"([a-zA-Z0-9]{32})"/);
            if (match) {
                this.#clientId = match[1];
                this.#clientIdExpiresAt = Date.now() + 6 * 60 * 60_000;
                return this.#clientId;
            }
        }

        throw new Error("Failed to extract SoundCloud client_id.");
    }

    #normalizeArtwork(url) {
        if (!url) {
            return null;
        }
        return url.replace(/-large\.(jpg|png)/, "-t500x500.$1");
    }

    #mapTrack(t) {
        return {
            id: t.id,
            title: t.title,
            artist: t.user?.username ?? null,
            duration_ms: t.duration ?? 0,
            url: t.permalink_url,
            artwork: this.#normalizeArtwork(t.artwork_url),
            genre: t.genre || null,
            plays: t.playback_count ?? 0,
            likes: t.likes_count ?? 0,
            description: t.description || null,
        };
    }

    /**
     * Search SoundCloud tracks.
     * @param {string} query
     * @param {{ limit?: number }} [opts]
     * @returns {Promise<object[]>}
     */
    async search(query, { limit = 10 } = {}) {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }

        const clientId = await this.#getClientId();
        const { data } = await this.#http.get(
            `${SoundCloud.#API}/search/tracks`,
            {
                params: { q: query, client_id: clientId, limit, offset: 0 },
            },
        );

        return (data.collection || []).map((t) => this.#mapTrack(t));
    }

    /**
     * Resolve any SoundCloud URL to its API entity.
     * @param {string} url
     * @returns {Promise<object>}
     */
    async resolve(url) {
        const clientId = await this.#getClientId();
        const { data } = await this.#http.get(`${SoundCloud.#API}/resolve`, {
            params: { url, client_id: clientId },
        });
        return data;
    }

    /**
     * Download a SoundCloud track — resolves the progressive stream URL.
     * @param {string} url - Track permalink URL
     * @returns {Promise<object>} { title, artist, duration_ms, artwork, streamUrl }
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("SoundCloud URL is required.");
        }
        if (!/soundcloud\.com\//i.test(url)) {
            throw new Error("Invalid SoundCloud URL.");
        }

        const clientId = await this.#getClientId();
        const track = await this.resolve(url);
        if (track.kind !== "track") {
            throw new Error(`Not a track (${track.kind || "unknown"}).`);
        }

        const transcodings = track.media?.transcodings || [];
        const full = transcodings.filter((t) => !t.snipped);
        const progressive =
            full.find((t) => t.format?.protocol === "progressive") ||
            full.find((t) => t.format?.protocol === "hls");
        if (!progressive?.url) {
            const snipped = transcodings.some((t) => t.snipped);
            throw new Error(
                snipped
                    ? "Track is preview-only (SoundCloud Go+ / label track)."
                    : "No stream available for this track.",
            );
        }

        const { data: stream } = await this.#http.get(progressive.url, {
            params: { client_id: clientId },
        });
        if (!stream?.url) {
            throw new Error("Failed to resolve stream URL.");
        }

        return {
            id: track.id,
            title: track.title,
            artist: track.user?.username ?? null,
            duration_ms: track.duration ?? 0,
            artwork: this.#normalizeArtwork(track.artwork_url),
            genre: track.genre || null,
            plays: track.playback_count ?? 0,
            protocol: progressive.format?.protocol || "progressive",
            mime: progressive.format?.mime_type || "audio/mpeg",
            streamUrl: stream.url,
        };
    }
}

export default SoundCloud;

let _shared;
export function getSoundCloud(opts) {
    if (!_shared) {
        _shared = new SoundCloud(opts);
    }
    return _shared;
}
