/**
 * @fileoverview Spotify search via GraphQL (no API key needed).
 * @module scrapers/spotify
 */

import { Buffer } from "node:buffer";
import { createHmac, randomUUID } from "node:crypto";
import axios from "axios";

const config = Object.freeze({
    secret: "376136387538459893883312310911992847112448894410210511297108",
    totpVersion: 61,
    clientVersion: "1.2.88.61.ge172202b",
    queries: {
        search: {
            operationName: "searchDesktop",
            sha256Hash:
                "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e",
        },
    },
});

export class Spotify {
    constructor({ timeout = 30_000 } = {}) {
        this.tokenExpiresAt = 0;
        this.http = axios.create({
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
        const digest = createHmac("sha1", Buffer.from(config.secret, "utf8"))
            .update(buffer)
            .digest();
        const offset = digest[digest.length - 1] & 0x0f;
        const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
        return String(code).padStart(6, "0");
    }

    async #getToken() {
        if (
            this.http.defaults.headers.common.authorization &&
            Date.now() < this.tokenExpiresAt - 60_000
        ) {
            return;
        }

        const now = Date.now();
        const { data: token } = await this.http.get(
            "https://open.spotify.com/api/token",
            {
                params: {
                    reason: "init",
                    productType: "web-player",
                    totp: this.#generateTOTP(now),
                    totpServer: this.#generateTOTP(
                        Math.floor(now / 1000) * 1000,
                    ),
                    totpVer: String(config.totpVersion),
                },
            },
        );

        const { data: client } = await this.http.post(
            "https://clienttoken.spotify.com/v1/clienttoken",
            {
                client_data: {
                    client_version: config.clientVersion,
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

        Object.assign(this.http.defaults.headers.common, {
            authorization: `Bearer ${token.accessToken}`,
            "client-token": client.granted_token.token,
            "spotify-app-version": config.clientVersion,
            "app-platform": "WebPlayer",
        });

        this.tokenExpiresAt =
            Number(token.accessTokenExpirationTimestampMs) ||
            Date.now() + 55 * 60_000;
    }

    /**
     * @param {string} query
     * @param {{ limit?: number }} [opts]
     * @returns {Promise<object[]>}
     */
    async search(query, { limit = 10 } = {}) {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }

        await this.#getToken();

        const { data } = await this.http.post(
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
                operationName: config.queries.search.operationName,
                extensions: {
                    persistedQuery: {
                        version: 1,
                        sha256Hash: config.queries.search.sha256Hash,
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

        const { data } = await this.http
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
}

export default Spotify;

/**
 * Cached singleton — token state lives across command invocations so we
 * skip the `/api/token` + `/clienttoken` round-trips on every search.
 */
let _shared;
export function getSpotify(opts) {
    if (!_shared) {
        _shared = new Spotify(opts);
    }
    return _shared;
}
