/**
 * @fileoverview TeraBox direct download link scraper.
 * Extracts file info and direct download URLs from TeraBox share links.
 * Uses a Cloudflare Worker proxy for sign verification (thanks to k6th).
 * Requires `ndus` cookie from a TeraBox account (set TERABOX_NDUS in .env).
 * @module scrapers/terabox
 */

import { URL } from "node:url";

class TeraBox {
    static #UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
    static #DEFAULT_PROXY = "https://worker.jawa.eu.cc/";
    static #ALLOWED_HOSTS = new Set([
        "terabox.app",
        "www.terabox.app",
        "teraboxshare.com",
        "www.teraboxshare.com",
        "terabox.com",
        "www.terabox.com",
        "1024terabox.com",
        "www.1024terabox.com",
        "1024tera.com",
        "www.1024tera.com",
        "teraboxlink.com",
        "www.teraboxlink.com",
        "terasharefile.com",
        "www.terasharefile.com",
        "terafileshare.com",
        "www.terafileshare.com",
        "terasharelink.com",
        "www.terasharelink.com",
        "freeterabox.com",
        "www.freeterabox.com",
    ]);

    #ndus;
    #proxy;

    constructor() {
        this.#ndus = process.env.TERABOX_NDUS || "";
        this.#proxy = process.env.TERABOX_PROXY || TeraBox.#DEFAULT_PROXY;
    }

    /**
     * Set the ndus cookie manually.
     * @param {string} ndus
     */
    setCookie(ndus) {
        this.#ndus = ndus;
    }

    /**
     * Set a custom proxy URL (self-hosted CF Worker).
     * @param {string} url
     */
    setProxy(url) {
        this.#proxy = url;
    }

    /**
     * Validate a TeraBox share URL.
     * @param {string} url
     * @returns {boolean}
     */
    isValid(url) {
        try {
            const parsed = new URL(url);
            if (!["http:", "https:"].includes(parsed.protocol)) {
                return false;
            }
            if (!TeraBox.#ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
                return false;
            }
            return (
                parsed.pathname.includes("/s/") ||
                parsed.searchParams.has("surl")
            );
        } catch {
            return false;
        }
    }

    /**
     * Format file size.
     * @param {number} bytes
     * @returns {string}
     */
    #formatSize(bytes) {
        if (!bytes) {
            return "0 bytes";
        }
        if (bytes >= 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        }
        if (bytes >= 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        }
        if (bytes >= 1024) {
            return `${(bytes / 1024).toFixed(2)} KB`;
        }
        return `${bytes} bytes`;
    }

    /**
     * Download file info and direct link from a TeraBox share URL.
     * @param {string} url - TeraBox share URL
     * @param {object} [options]
     * @param {string} [options.password] - Password for protected links
     * @returns {Promise<{files: Array<{name: string, size: string, sizeBytes: number, dlink: string, thumbnail: string}>}>}
     */
    async download(url, _options = {}) {
        if (!this.#ndus) {
            throw new Error(
                "TeraBox ndus cookie not set. Set TERABOX_NDUS in .env or call setCookie().",
            );
        }

        if (!this.isValid(url)) {
            throw new Error(
                "Invalid TeraBox URL. Supported: terabox.com, 1024terabox.com, teraboxshare.com, etc.",
            );
        }

        // Use CF Worker proxy to resolve (handles sign verification)
        const proxyUrl = new URL(`${this.#proxy}api`);
        proxyUrl.searchParams.set("url", url);

        const res = await fetch(proxyUrl.toString(), {
            headers: { "User-Agent": TeraBox.#UA },
            signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
            throw new Error(`Proxy request failed: ${res.status}`);
        }

        const data = await res.json();

        if (data.error) {
            throw new Error(`TeraBox error: ${data.error}`);
        }

        const fileList = data.files || [];
        if (!fileList.length) {
            throw new Error("No files found in this share link.");
        }

        const files = fileList.map((f) => ({
            name: f.filename || "Unknown",
            size:
                typeof f.size === "number"
                    ? this.#formatSize(f.size)
                    : f.size || "0 bytes",
            sizeBytes: typeof f.size === "number" ? f.size : f.size_bytes || 0,
            dlink: f.download_link || "",
            thumbnail: f.thumbnails?.url3 || f.thumbnail || "",
            isDir: f.is_directory || false,
        }));

        return { files };
    }

    /**
     * Get a single file's direct download link (convenience method).
     * Returns the dlink which can be downloaded with ndus cookie.
     * @param {string} url - TeraBox share URL
     * @param {object} [options]
     * @returns {Promise<{name: string, size: string, sizeBytes: number, url: string, thumbnail: string}>}
     */
    async getLink(url, options = {}) {
        const { files } = await this.download(url, options);
        if (!files.length) {
            throw new Error("No files found in this share link.");
        }

        const file = files[0];
        return {
            name: file.name,
            size: file.size,
            sizeBytes: file.sizeBytes,
            url: file.dlink,
            thumbnail: file.thumbnail,
        };
    }

    /**
     * Download file buffer from TeraBox.
     * @param {string} url - TeraBox share URL
     * @param {object} [options]
     * @returns {Promise<{name: string, size: string, buffer: Buffer}>}
     */
    async getBuffer(url, options = {}) {
        const link = await this.getLink(url, options);

        if (!link.url) {
            throw new Error("No download link available.");
        }

        const res = await fetch(link.url, {
            headers: {
                "User-Agent": TeraBox.#UA,
                Cookie: `ndus=${this.#ndus}`,
                Referer: "https://www.terabox.com/",
            },
        });

        if (!res.ok) {
            throw new Error(`Download failed: ${res.status}`);
        }

        return {
            name: link.name,
            size: link.size,
            buffer: Buffer.from(await res.arrayBuffer()),
        };
    }
}

export default new TeraBox();
