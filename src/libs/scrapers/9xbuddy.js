/**
 * @fileoverview 9xbuddy scraper for multi-platform video downloads.
 * Reverse-engineered from 9xbuddy.com frontend (v12.x).
 * @module scrapers/9xbuddy
 */

import axios from "axios";

class NinexBuddyCrypto {
    decode64(e) {
        if (
            ((e = e.replace(/\s/g, "")),
            !/^[a-z0-9+/\s]+=*$/i.test(e) || e.length % 4 > 0)
        ) {
            return "";
        }
        let t = 0,
            n, 
            r,
            i,
            a = [];
        for (e = e.replace(/=/g, ""); t < e.length; ) {
            n =
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(
                    e.charAt(t),
                );
            i = t % 4;
            switch (i) {
                case 1:
                    a.push(String.fromCharCode((r << 2) | (n >> 4)));
                    break;
                case 2:
                    a.push(String.fromCharCode(((r & 15) << 4) | (n >> 2)));
                    break;
                case 3:
                    a.push(String.fromCharCode(((r & 3) << 6) | n));
                    break;
            }
            r = n;
            t++;
        }
        return a.join("");
    }

    ord(e) {
        const t = `${e}`;
        const n = t.charCodeAt(0);
        if (n >= 55296 && n <= 56319) {
            if (t.length === 1) {
                return n;
            }
            const r = t.charCodeAt(1);
            return (n - 55296) * 1024 + (r - 56320) + 65536;
        }
        return n;
    }

    encode64(e) {
        const t =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let n = 0,
            r,
            prev,
            mod,
            o = [];
        while (n < e.length) {
            r = e.charCodeAt(n);
            mod = n % 3;
            switch (mod) {
                case 0:
                    o.push(t.charAt(r >> 2));
                    break;
                case 1:
                    o.push(t.charAt(((prev & 3) << 4) | (r >> 4)));
                    break;
                case 2:
                    o.push(t.charAt(((prev & 15) << 2) | (r >> 6)));
                    o.push(t.charAt(r & 63));
                    break;
            }
            prev = r;
            n++;
        }
        if (mod === 0) {
            o.push(t.charAt((prev & 3) << 4));
            o.push("==");
        } else if (mod === 1) {
            o.push(t.charAt((prev & 15) << 2));
            o.push("=");
        }
        return o.join("");
    }

    encrypt(e, t) {
        let n = "";
        for (let r = 0; r < e.length; r++) {
            const ch = e.charAt(r);
            const key = t.charAt(((r % t.length) - 1 + t.length) % t.length);
            n += String.fromCharCode(this.ord(ch) + this.ord(key));
        }
        return this.encode64(n);
    }

    decrypt(e, t) {
        let n = "";
        e = this.decode64(e);
        for (let r = 0; r < e.length; r++) {
            const ch = e.charAt(r);
            const key = t.charAt(((r % t.length) - 1 + t.length) % t.length);
            n += String.fromCharCode(this.ord(ch) - this.ord(key));
        }
        return n;
    }

    hex2bin(e) {
        const t = [];
        for (let n = 0; n < e.length; n += 2) {
            const hi = parseInt(e.charAt(n), 16);
            const lo = parseInt(e.charAt(n + 1), 16);
            if (Number.isNaN(hi) || Number.isNaN(lo)) {
                return null;
            }
            t.push((hi << 4) | lo);
        }
        return String.fromCharCode(...t);
    }
}

class NinexBuddy {
    #crypto = new NinexBuddyCrypto();
    #hostname = "9xbuddy.com";
    #ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    /**
     * Fetch page config from 9xbuddy (CSS hash, API base, version, UA).
     * @returns {Promise<{cssHash: string, apiBase: string, appVersion: string, uaBase64: string}>}
     */
    async #getConfig() {
        const { data: html } = await axios.get("https://9xbuddy.com/", {
            headers: { "User-Agent": this.#ua },
            timeout: 15_000,
        });

        const cssMatch = html.match(
            /\/build\/(?:assets\/)?main\.([^"]+?)\.css/,
        );
        if (!cssMatch) {
            throw new Error("9xbuddy: Could not extract CSS hash.");
        }

        const initMatch = html.match(
            /window\.__INIT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
        );
        if (!initMatch) {
            throw new Error("9xbuddy: Could not extract __INIT__ config.");
        }

        const init = JSON.parse(initMatch[1]);
        return {
            cssHash: cssMatch[1],
            apiBase: init.apiBase,
            appVersion: init.appVersion,
            uaBase64: init.ua,
        };
    }

    /**
     * Generate x-auth-token from page config.
     * @param {string} cssHash
     * @param {string} appVersion
     * @param {string} uaBase64
     * @returns {string}
     */
    #generateAuthToken(cssHash, appVersion, uaBase64) {
        const key = cssHash.split("").reverse().join("");
        const uaPart = uaBase64.split("").reverse().join("").substring(0, 10);
        const secret = [
            90, 84, 94, 100, 81, 81, 74, 89, 100, 70, 83, 83, 84, 76, 100, 89,
            84, 83, 100, 82, 78, 100, 74, 89, 70, 82, 100, 94, 87, 87, 84, 88,
        ]
            .map((c) => String.fromCharCode(c - 5))
            .reverse()
            .join("");
        const suffix = `xbuddy123sudo-${appVersion}`;
        const plaintext =
            this.#hostname + key + uaPart + secret + suffix + appVersion;
        return this.#crypto.encrypt(plaintext, key);
    }

    /**
     * Generate _sig for extract request.
     * @param {string} url - Video URL (not encoded)
     * @param {string} authToken - Generated auth token
     * @returns {string}
     */
    #generateSig(url, authToken) {
        const encoded = encodeURIComponent(url);
        const sigKey = `${authToken}jv7g2_DAMNN_DUDE`;
        return this.#crypto.encrypt(encoded, sigKey);
    }

    /**
     * Decrypt an encrypted media URL from API response.
     * @param {string} encrypted - Hex-encoded encrypted URL
     * @param {string} token - Response token
     * @param {string} cssHash - CSS hash from page
     * @returns {string|null}
     */
    #decryptUrl(encrypted, token, cssHash) {
        const bin = this.#crypto.hex2bin(encrypted);
        if (!bin) {
            return null;
        }
        const reversed = bin.split("").reverse().join("");
        const prefix = [69, 84, 65, 77, 95, 89, 82, 82, 79, 83]
            .map((c) => String.fromCharCode(c))
            .join("")
            .split("")
            .reverse()
            .join("");
        const decryptKey = `${prefix}${this.#hostname.length}${cssHash}${token}`;
        return this.#crypto.decrypt(reversed, decryptKey);
    }

    /**
     * Create an authenticated session with 9xbuddy API.
     * @returns {Promise<{headers: object, apiBase: string, cssHash: string, authToken: string}>}
     */
    async #createSession() {
        const config = await this.#getConfig();
        const authToken = this.#generateAuthToken(
            config.cssHash,
            config.appVersion,
            config.uaBase64,
        );

        const headers = {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Requested-With": "xmlhttprequest",
            "x-auth-token": authToken,
            "x-requested-domain": this.#hostname,
            "User-Agent": this.#ua,
            Origin: "https://9xbuddy.com",
            Referer: "https://9xbuddy.com/",
        };

        const { data: tokenRes } = await axios.post(
            `${config.apiBase}/token`,
            {},
            { headers, timeout: 15_000 },
        );

        if (!tokenRes.access_token) {
            throw new Error("9xbuddy: Failed to get access token.");
        }

        return {
            headers: { ...headers, "x-access-token": tokenRes.access_token },
            apiBase: config.apiBase,
            cssHash: config.cssHash,
            authToken,
        };
    }

    /**
     * Extract download links from a video URL.
     * Supports YouTube, Dailymotion, Vimeo, and many other sites.
     *
     * @param {string} url - Video URL to extract
     * @returns {Promise<{title: string, thumbnail: string, duration: string, formats: Array<{quality: string, ext: string, url: string, type: string, size: string}>}>}
     */
    async extract(url) {
        if (!url?.trim()) {
            throw new Error("Video URL is required.");
        }

        const { headers, apiBase, cssHash, authToken } =
            await this.#createSession();
        const sig = this.#generateSig(url.trim(), authToken);

        const { data: res } = await axios.post(
            `${apiBase}/extract`,
            {
                url: encodeURIComponent(url.trim()),
                _sig: sig,
            },
            { headers, timeout: 30_000 },
        );

        if (!res.status || !res.response) {
            throw new Error(res.message || "9xbuddy: No download links found.");
        }

        const response = res.response;
        const token = response.token || "";
        const rawFormats = response.formats || [];

        const formats = rawFormats
            .map((f) => {
                let downloadUrl = null;
                if (f.url) {
                    downloadUrl = this.#decryptUrl(f.url, token, cssHash);
                }
                return {
                    quality: f.quality || "",
                    ext: f.ext || "",
                    url: downloadUrl || "",
                    type: f.type || "video",
                    size: f.size || "-",
                    isExternal: f.external === "true",
                    isConvert: downloadUrl?.startsWith("/convert/") || false,
                };
            })
            .filter((f) => f.url);

        return {
            title: response.title || "",
            thumbnail: response.thumbnail || "",
            duration: response.duration || "",
            uploader: response.uploader || "",
            formats,
        };
    }

    /**
     * Get direct download URL for a format.
     * For /convert/ URLs, returns the full 9xbuddy convert URL.
     * For external URLs (offmp3.com, etc.), returns the service URL.
     * For direct URLs (googlevideo, etc.), returns as-is.
     *
     * @param {object} format - Format object from extract()
     * @returns {string} Full download URL
     */
    getDownloadUrl(format) {
        if (!format?.url) {
            return "";
        }

        if (format.url.startsWith("/convert/")) {
            return `https://9xbuddy.com${format.url}`;
        }
        if (format.url.startsWith("//")) {
            return `https:${format.url}`;
        }
        return format.url;
    }
}

export default new NinexBuddy();
