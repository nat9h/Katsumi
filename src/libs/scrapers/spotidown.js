/**
 * @fileoverview SpotiDown.app scraper — download Spotify tracks to MP3.
 * Flow: GET session → POST /action → POST /action/track → download link.
 * @module scrapers/spotidown
 */

import axios from "axios";

class SpotiDown {
    BASE_URL = "https://spotidown.app";

    UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    #session = { cookie: "", csrfName: "", csrfValue: "", expiresAt: 0 };

    /**
     * Ensure we have a valid session (cookie + CSRF token).
     */
    async #ensureSession() {
        if (this.#session.cookie && Date.now() < this.#session.expiresAt) {
            return;
        }

        const { headers, data } = await axios.get(this.BASE_URL, {
            headers: { "User-Agent": this.UA },
            timeout: 15_000,
        });

        const cookies = headers["set-cookie"];
        const cookie = cookies?.map((c) => c.split(";")[0]).join("; ") || "";

        const csrfMatch = data.match(
            /<input\s+name="([^"]+)"\s+type="hidden"\s+value="([^"]+)"/i,
        );

        this.#session = {
            cookie,
            csrfName: csrfMatch?.[1] || "",
            csrfValue: csrfMatch?.[2] || "",
            expiresAt: Date.now() + 50 * 60_000,
        };
    }

    /**
     * Download a Spotify track via spotidown.app.
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

        await this.#ensureSession();

        const formData = new URLSearchParams();
        formData.append("url", url.trim());
        formData.append("g-recaptcha-response", "");
        if (this.#session.csrfName) {
            formData.append(this.#session.csrfName, this.#session.csrfValue);
        }

        const { data: actionResp } = await axios.post(
            `${this.BASE_URL}/action`,
            formData,
            {
                headers: {
                    "User-Agent": this.UA,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Requested-With": "XMLHttpRequest",
                    Referer: `${this.BASE_URL}/`,
                    Origin: this.BASE_URL,
                    Cookie: this.#session.cookie,
                },
                timeout: 20_000,
            },
        );

        if (actionResp.error) {
            if (actionResp.errorcode === "error_token") {
                this.#session.expiresAt = 0;
                await this.#ensureSession();
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

    /**
     * Parse track info from the action response HTML.
     * @param {string} html
     * @returns {Array<object>}
     */
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

    /**
     * Resolve the direct download link for a track.
     * @param {object} track
     * @returns {Promise<string|null>}
     */
    async #resolveTrack(track) {
        if (!track.formData) {
            return null;
        }

        const formData = new URLSearchParams();
        formData.append("data", track.formData);
        if (track.base) {
            formData.append("base", track.base);
        }
        if (track.token) {
            formData.append("token", track.token);
        }

        const { data } = await axios.post(
            `${this.BASE_URL}/action/track`,
            formData,
            {
                headers: {
                    "User-Agent": this.UA,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Requested-With": "XMLHttpRequest",
                    Referer: `${this.BASE_URL}/`,
                    Origin: this.BASE_URL,
                    Cookie: this.#session.cookie,
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

    /**
     * Extract the direct download URL from response HTML.
     * @param {string} html
     * @returns {string|null}
     */
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

export default new SpotiDown();
