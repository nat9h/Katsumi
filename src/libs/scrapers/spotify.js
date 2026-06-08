/**
 * @fileoverview Spotify search + download (via SpotiDown.app) — no API key needed.
 * Combines GraphQL search and SpotiDown MP3 downloader into one module.
 * @module scrapers/spotify
 */

import { Buffer } from "node:buffer";
import { createHmac, randomUUID } from "node:crypto";
import axios from "axios";

export class Spotify {
    static #SECRET =
        "376136387538459893883312310911992847112448894410210511297108";
    static #TOTP_VERSION = 61;
    static #CLIENT_VERSION = "1.2.88.61.ge172202b";
    static #SEARCH_HASH =
        "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e";

    static #SPOTIDOWN_URL = "https://spotidown.app";
    static #SPOTIDOWN_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    #tokenExpiresAt = 0;
    #http;
    #dlSession = { cookie: "", csrfName: "", csrfValue: "", expiresAt: 0 };

    constructor({ timeout = 30_000 } = {}) {
        this.#http = axios.create({
            timeout,
            headers: {
                referer: "https://open.spotify.com/",
                origin: "https://open.spotify.com",
                "content-type": "application/json",
                accept: "application/json",
                "user-agent":
                    "Mozilla/5.0 (Linux; Android 16; NX729J) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.34 Mobile Safari/537.36",
            },
        });
    }

    #generateTOTP(timestampMs = Date.now()) {
        const counter = Math.floor(timestampMs / 1000 / 30);
        const buffer = Buffer.alloc(8);
        buffer.writeBigInt64BE(BigInt(counter));
        const digest = createHmac("sha1", Buffer.from(Spotify.#SECRET, "utf8"))
            .update(buffer)
            .digest();
        const offset = digest[digest.length - 1] & 0x0f;
        const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
        return String(code).padStart(6, "0");
    }

    async #getToken() {
        if (
            this.#http.defaults.headers.common.authorization &&
            Date.now() < this.#tokenExpiresAt - 60_000
        ) {
            return;
        }

        const now = Date.now();
        const { data: token } = await this.#http.get(
            "https://open.spotify.com/api/token",
            {
                params: {
                    reason: "init",
                    productType: "web-player",
                    totp: this.#generateTOTP(now),
                    totpServer: this.#generateTOTP(
                        Math.floor(now / 1000) * 1000,
                    ),
                    totpVer: String(Spotify.#TOTP_VERSION),
                },
            },
        );

        const { data: client } = await this.#http.post(
            "https://clienttoken.spotify.com/v1/clienttoken",
            {
                client_data: {
                    client_version: Spotify.#CLIENT_VERSION,
                    client_id: token.clientId,
                    js_sdk_data: {
                        device_brand: "unknown",
                        device_model: "unknown",
                        os: "linux",
                        os_version: "24.04",
                        device_id: randomUUID(),
                        device_type: "computer",
                    },
                },
            },
        );

        Object.assign(this.#http.defaults.headers.common, {
            authorization: `Bearer ${token.accessToken}`,
            "client-token": client.granted_token.token,
            "spotify-app-version": Spotify.#CLIENT_VERSION,
            "app-platform": "WebPlayer",
        });

        this.#tokenExpiresAt =
            Number(token.accessTokenExpirationTimestampMs) ||
            Date.now() + 55 * 60_000;
    }

    /**
     * Search Spotify tracks.
     * @param {string} query
     * @param {{ limit?: number }} [opts]
     * @returns {Promise<object[]>}
     */
    async search(query, { limit = 10 } = {}) {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }

        await this.#getToken();

        const { data } = await this.#http.post(
            "https://api-partner.spotify.com/pathfinder/v2/query",
            {
                variables: {
                    searchTerm: query,
                    offset: 0,
                    limit,
                    numberOfTopResults: 5,
                    includeAudiobooks: false,
                    includeArtistHasConcertsField: false,
                    includePreReleases: true,
                    includeAuthors: false,
                    includeEpisodeContentRatingsV2: false,
                },
                operationName: "searchDesktop",
                extensions: {
                    persistedQuery: {
                        version: 1,
                        sha256Hash: Spotify.#SEARCH_HASH,
                    },
                },
            },
        );

        const items = data?.data?.searchV2?.tracksV2?.items || [];
        return items
            .map((node) => {
                const track = node.item?.data;
                if (!track) {
                    return null;
                }
                return {
                    name: track.name ?? null,
                    uri: track.uri ?? null,
                    url: track.uri
                        ? `https://open.spotify.com/track/${track.uri.split(":")[2]}`
                        : null,
                    duration_ms: track.duration?.totalMilliseconds ?? 0,
                    explicit: track.contentRating?.label === "EXPLICIT",
                    artists: (track.artists?.items || []).map((a) => ({
                        name: a.profile?.name ?? null,
                        uri: a.uri ?? null,
                    })),
                    album: {
                        name: track.albumOfTrack?.name ?? null,
                        image:
                            track.albumOfTrack?.coverArt?.sources?.[0]?.url ??
                            null,
                    },
                };
            })
            .filter(Boolean);
    }

    /**
     * Get a single track by URL or URI.
     * @param {string} input - Spotify URL or URI
     * @returns {Promise<object|null>}
     */
    async getTrack(input) {
        const id = this.#extractId(input);
        if (!id) {
            return null;
        }

        await this.#getToken();

        const results = await this.search(id, { limit: 1 });
        if (results.length) {
            return results[0];
        }

        const { data } = await this.#http
            .get(`https://api.spotify.com/v1/tracks/${id}`)
            .catch(() => ({ data: null }));
        if (!data) {
            return null;
        }

        return {
            name: data.name,
            uri: data.uri,
            url: data.external_urls?.spotify,
            duration_ms: data.duration_ms || 0,
            explicit: data.explicit || false,
            artists: (data.artists || []).map((a) => ({
                name: a.name,
                uri: a.uri,
            })),
            album: {
                name: data.album?.name ?? null,
                image: data.album?.images?.[0]?.url ?? null,
            },
        };
    }

    #extractId(input) {
        const str = String(input).trim();
        if (str.startsWith("spotify:track:")) {
            return str.split(":")[2];
        }
        const match = str.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
        return match?.[1] || null;
    }

    async #ensureDlSession() {
        if (this.#dlSession.cookie && Date.now() < this.#dlSession.expiresAt) {
            return;
        }

        const { headers, data } = await axios.get(Spotify.#SPOTIDOWN_URL, {
            headers: { "User-Agent": Spotify.#SPOTIDOWN_UA },
            timeout: 15_000,
        });

        const cookies = headers["set-cookie"];
        const cookie = cookies?.map((c) => c.split(";")[0]).join("; ") || "";
        const csrfMatch = data.match(
            /<input\s+name="([^"]+)"\s+type="hidden"\s+value="([^"]+)"/i,
        );

        this.#dlSession = {
            cookie,
            csrfName: csrfMatch?.[1] || "",
            csrfValue: csrfMatch?.[2] || "",
            expiresAt: Date.now() + 50 * 60_000,
        };
    }

    /**
     * Download a Spotify track via SpotiDown.app.
     * @param {string} url - Spotify track/album/playlist URL
     * @returns {Promise<object|object[]>} Track info with download link(s)
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("Spotify URL is required.");
        }
        if (!/open\.spotify\.com\//i.test(url)) {
            throw new Error("Invalid Spotify URL.");
        }

        await this.#ensureDlSession();

        const form = new URLSearchParams();
        form.append("url", url.trim());
        form.append("g-recaptcha-response", "");
        if (this.#dlSession.csrfName) {
            form.append(this.#dlSession.csrfName, this.#dlSession.csrfValue);
        }

        const { data: actionResp } = await axios.post(
            `${Spotify.#SPOTIDOWN_URL}/action`,
            form,
            {
                headers: {
                    "User-Agent": Spotify.#SPOTIDOWN_UA,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Requested-With": "XMLHttpRequest",
                    Referer: `${Spotify.#SPOTIDOWN_URL}/`,
                    Origin: Spotify.#SPOTIDOWN_URL,
                    Cookie: this.#dlSession.cookie,
                },
                timeout: 20_000,
            },
        );

        if (actionResp.error) {
            if (actionResp.errorcode === "error_token") {
                this.#dlSession.expiresAt = 0;
                await this.#ensureDlSession();
                return this.download(url);
            }
            throw new Error(actionResp.message || "SpotiDown error.");
        }

        const tracks = this.#parseTracksFromHtml(actionResp.data);
        if (!tracks.length) {
            throw new Error("No tracks found in response.");
        }

        const results = [];
        for (const track of tracks) {
            const downloadUrl = await this.#resolveTrack(track);
            results.push({
                title: track.title,
                artist: track.artist,
                album: track.album,
                cover: track.cover,
                duration: track.duration,
                date: track.date,
                downloadUrl,
            });
        }

        return results.length === 1 ? results[0] : results;
    }

    #parseTracksFromHtml(html) {
        const tracks = [];
        const dataMatches = [
            ...html.matchAll(/name=["']data["']\s*value=["']([^"']+)["']/gi),
        ];
        const baseValue =
            html.match(/name=["']base["']\s*value=["']([^"']+)["']/i)?.[1] ||
            "";
        const tokenValue =
            html.match(/name=["']token["']\s*value=["']([^"']+)["']/i)?.[1] ||
            "";

        for (const match of dataMatches) {
            const info = JSON.parse(
                Buffer.from(match[1], "base64").toString("utf8"),
            );
            tracks.push({
                title: info.name || "Unknown",
                artist: info.artist || "Unknown",
                album: info.album || "",
                cover: info.cover || "",
                duration: info.duration || "",
                date: info.date || "",
                formData: match[1],
                base: baseValue,
                token: tokenValue,
            });
        }

        return tracks;
    }

    async #resolveTrack(track) {
        if (!track.formData) {
            return null;
        }

        const form = new URLSearchParams();
        form.append("data", track.formData);
        if (track.base) {
            form.append("base", track.base);
        }
        if (track.token) {
            form.append("token", track.token);
        }

        const { data } = await axios.post(
            `${Spotify.#SPOTIDOWN_URL}/action/track`,
            form,
            {
                headers: {
                    "User-Agent": Spotify.#SPOTIDOWN_UA,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Requested-With": "XMLHttpRequest",
                    Referer: `${Spotify.#SPOTIDOWN_URL}/`,
                    Origin: Spotify.#SPOTIDOWN_URL,
                    Cookie: this.#dlSession.cookie,
                },
                timeout: 30_000,
            },
        );

        if (typeof data === "object" && data.error) {
            return null;
        }
        const html = typeof data === "object" ? data.data || "" : String(data);
        return this.#extractDownloadUrl(html);
    }

    #extractDownloadUrl(html) {
        if (!html) {
            return null;
        }

        const popup = html.match(
            /<a[^>]*id=["']popup["'][^>]*href=["']([^"']+)["']/i,
        );
        if (popup) {
            return popup[1];
        }

        const rapid = html.match(
            /href=["'](https?:\/\/rapid\.spotidown\.app[^"']+)["']/i,
        );
        if (rapid) {
            return rapid[1];
        }

        const mp3 = html.match(/href=["'](https?:\/\/[^"']*\.mp3[^"']*)["']/i);
        if (mp3) {
            return mp3[1];
        }

        return null;
    }
}

export default Spotify;

/** Cached singleton — token + session state lives across command invocations. */
let _shared;
export function getSpotify(opts) {
    if (!_shared) {
        _shared = new Spotify(opts);
    }
    return _shared;
}
