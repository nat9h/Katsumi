/**
 * @fileoverview LRCLIB lyrics API wrapper — synced & plain lyrics.
 * @module scrapers/lrclib
 * @see https://lrclib.net/docs
 */

import axios from "axios";

export class LrcLib {
    constructor({ timeout = 10_000 } = {}) {
        this.http = axios.create({
            baseURL: "https://lrclib.net/api",
            timeout,
            headers: {
                "user-agent":
                    "Katsumi-Bot/1.0.0 (https://github.com/nat9h/Katsumi)",
            },
        });
    }

    /**
     * Free-text search for lyrics.
     * @param {string} query
     * @returns {Promise<Array<LrcLibResult>>}
     */
    async search(query) {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }

        const { data } = await this.http.get("/search", {
            params: { q: query },
        });

        return (data || []).map(this.#normalize);
    }

    /**
     * Structured search by track name and optionally artist/album.
     * @param {{ trackName: string, artistName?: string, albumName?: string }} opts
     * @returns {Promise<Array<LrcLibResult>>}
     */
    async searchByTrack({ trackName, artistName, albumName }) {
        if (!trackName?.trim()) {
            throw new Error("Track name is required.");
        }

        const params = { track_name: trackName };
        if (artistName) {
            params.artist_name = artistName;
        }
        if (albumName) {
            params.album_name = albumName;
        }

        const { data } = await this.http.get("/search", { params });

        return (data || []).map(this.#normalize);
    }

    /**
     * Get exact match lyrics by track metadata.
     * @param {{ trackName: string, artistName: string, albumName?: string, duration?: number }} opts
     * @returns {Promise<LrcLibResult|null>}
     */
    async get({ trackName, artistName, albumName, duration }) {
        if (!trackName || !artistName) {
            throw new Error("Track name and artist name are required.");
        }

        const params = {
            track_name: trackName,
            artist_name: artistName,
        };
        if (albumName) {
            params.album_name = albumName;
        }
        if (duration) {
            params.duration = duration;
        }

        try {
            const { data } = await this.http.get("/get", { params });
            return data ? this.#normalize(data) : null;
        } catch (err) {
            if (err.response?.status === 404) {
                return null;
            }
            throw err;
        }
    }

    /**
     * Get lyrics by LRCLIB track ID.
     * @param {number} id
     * @returns {Promise<LrcLibResult|null>}
     */
    async getById(id) {
        try {
            const { data } = await this.http.get(`/get/${id}`);
            return data ? this.#normalize(data) : null;
        } catch (err) {
            if (err.response?.status === 404) {
                return null;
            }
            throw err;
        }
    }

    /**
     * @param {object} raw
     * @returns {LrcLibResult}
     */
    #normalize = (raw) => ({
        id: raw.id,
        trackName: raw.trackName || raw.name || "",
        artistName: raw.artistName || "",
        albumName: raw.albumName || "",
        duration: raw.duration || 0,
        instrumental: raw.instrumental || false,
        plainLyrics: raw.plainLyrics || null,
        syncedLyrics: raw.syncedLyrics || null,
    });
}

/**
 * @typedef {object} LrcLibResult
 * @property {number} id
 * @property {string} trackName
 * @property {string} artistName
 * @property {string} albumName
 * @property {number} duration
 * @property {boolean} instrumental
 * @property {string|null} plainLyrics
 * @property {string|null} syncedLyrics
 */

export default LrcLib;

/**
 * Format synced lyrics for display — simplifies [mm:ss.xx] to [mm:ss].
 * @param {string} synced - Raw LRC synced lyrics
 * @returns {string}
 */
export function formatSynced(synced) {
    return synced
        .split("\n")
        .map((line) => {
            const match = line.match(/^\[(\d{2}):(\d{2})\.\d{2,3}\]\s?(.*)/);
            if (!match) {
                return line;
            }
            const [, min, sec, text] = match;
            if (!text.trim()) {
                return "";
            }
            return `[${min}:${sec}] ${text}`;
        })
        .filter((line) => line.trim())
        .join("\n");
}

/** Cached singleton */
let _shared;
export function getLrcLib(opts) {
    if (!_shared) {
        _shared = new LrcLib(opts);
    }
    return _shared;
}
