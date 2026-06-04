/**
 * @fileoverview Morphic.sh AI Chat Scraper
 * Supports: login (Supabase auth), text chat, image upload + chat
 * Flow: Login → Get token → Chat (SSE stream) → Parse response
 *
 * Model: google:gemini-3.1-flash-lite (default, determined by server)
 * Features: web search, image analysis, streaming response
 *
 * @module scrapers/morphic
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import FormData from "form-data";

class Morphic {
    SUPABASE_URL = "https://hduhhuczoiqbwdpsrtyc.supabase.co";
    SUPABASE_KEY = "sb_publishable_ck5Zdp9vRykRhdm7C8842g_MZj2iM7W";
    BASE_URL = "https://chat.morphic.sh";
    UA =
        "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.7166.92 Safari/537.36";

    constructor() {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = 0;
        this.userId = null;
        this.authCookie = null;
        this._loginPromise = null;
    }

    /**
     * Ensure logged in (auto-login from env if needed)
     * @returns {Promise<void>}
     */
    async ensureAuth() {
        if (this.accessToken) {
            await this.refreshIfNeeded();
            return;
        }

        if (this._loginPromise) {
            await this._loginPromise;
            return;
        }

        const email = process.env.MORPHIC_EMAIL;
        const password = process.env.MORPHIC_PASSWORD;
        if (!email || !password) {
            throw new Error(
                "MORPHIC_EMAIL and MORPHIC_PASSWORD required in .env",
            );
        }

        this._loginPromise = this.login(email, password);
        try {
            await this._loginPromise;
        } finally {
            this._loginPromise = null;
        }
    }

    /**
     * Generate random chat ID
     * @returns {string}
     */
    generateChatId() {
        return crypto
            .randomBytes(12)
            .toString("base64url")
            .slice(0, 24)
            .toLowerCase();
    }

    /**
     * Generate random message ID
     * @returns {string}
     */
    generateMessageId() {
        return crypto.randomBytes(16).toString("hex").slice(0, 24);
    }

    /**
     * Login to Morphic via Supabase auth
     * @param {string} email
     * @param {string} password
     * @returns {Promise<object>} Auth data
     */
    async login(email, password) {
        const { data } = await axios.post(
            `${this.SUPABASE_URL}/auth/v1/token?grant_type=password`,
            {
                email,
                password,
                gotrue_meta_security: {},
            },
            {
                headers: {
                    "Content-Type": "application/json;charset=UTF-8",
                    apikey: this.SUPABASE_KEY,
                    authorization: `Bearer ${this.SUPABASE_KEY}`,
                    origin: this.BASE_URL,
                    referer: `${this.BASE_URL}/`,
                    "user-agent": this.UA,
                    "x-client-info": "supabase-ssr/0.6.1 createBrowserClient",
                    "x-supabase-api-version": "2024-01-01",
                },
                timeout: 15_000,
            },
        );

        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token;
        this.expiresAt = data.expires_at;
        this.userId = data.user?.id;
        this.authCookie = `base64-${Buffer.from(JSON.stringify(data)).toString("base64")}`;

        return data;
    }

    /**
     * Refresh token if expired
     * @returns {Promise<void>}
     */
    async refreshIfNeeded() {
        const now = Math.floor(Date.now() / 1000);
        if (this.expiresAt && now < this.expiresAt - 60) {
            return;
        }

        if (!this.refreshToken) {
            throw new Error("No refresh token. Login first.");
        }

        const { data } = await axios.post(
            `${this.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
            { refresh_token: this.refreshToken },
            {
                headers: {
                    "Content-Type": "application/json;charset=UTF-8",
                    apikey: this.SUPABASE_KEY,
                    authorization: `Bearer ${this.SUPABASE_KEY}`,
                    origin: this.BASE_URL,
                    referer: `${this.BASE_URL}/`,
                    "user-agent": this.UA,
                    "x-client-info": "supabase-ssr/0.6.1 createBrowserClient",
                    "x-supabase-api-version": "2024-01-01",
                },
                timeout: 15_000,
            },
        );

        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token;
        this.expiresAt = data.expires_at;
        this.authCookie = `base64-${Buffer.from(JSON.stringify(data)).toString("base64")}`;
    }

    /**
     * Get cookie header string
     * @param {"quick"|"adaptive"} [mode="adaptive"] - Search mode
     * @returns {string}
     */
    getCookieHeader(mode = "adaptive") {
        return `searchMode=${mode}; sb-hduhhuczoiqbwdpsrtyc-auth-token=${this.authCookie}`;
    }

    /**
     * Upload an image file to Morphic
     * @param {string} filePath - Path to image file
     * @param {string} chatId - Chat ID
     * @param {"quick"|"adaptive"} [mode="adaptive"]
     * @returns {Promise<object>} {url, filename, mediaType}
     */
    async uploadImage(filePath, chatId, mode = "adaptive") {
        await this.ensureAuth();

        const form = new FormData();
        const filename = path.basename(filePath);
        form.append("file", fs.createReadStream(filePath), { filename });
        form.append("chatId", chatId);

        const { data } = await axios.post(`${this.BASE_URL}/api/upload`, form, {
            headers: {
                ...form.getHeaders(),
                cookie: this.getCookieHeader(mode),
                origin: this.BASE_URL,
                referer: `${this.BASE_URL}/search/${chatId}`,
                "user-agent": this.UA,
            },
            timeout: 30_000,
        });

        if (!data.success) {
            throw new Error("Upload failed");
        }
        return data.file;
    }

    /**
     * Upload image from buffer
     * @param {Buffer} buffer
     * @param {string} filename
     * @param {string} mimetype
     * @param {string} chatId
     * @param {"quick"|"adaptive"} [mode="adaptive"]
     * @returns {Promise<object>} {url, filename, mediaType}
     */
    async uploadBuffer(buffer, filename, mimetype, chatId, mode = "adaptive") {
        await this.ensureAuth();

        const form = new FormData();
        form.append("file", buffer, { filename, contentType: mimetype });
        form.append("chatId", chatId);

        const { data } = await axios.post(`${this.BASE_URL}/api/upload`, form, {
            headers: {
                ...form.getHeaders(),
                cookie: this.getCookieHeader(mode),
                origin: this.BASE_URL,
                referer: `${this.BASE_URL}/search/${chatId}`,
                "user-agent": this.UA,
            },
            timeout: 30_000,
        });

        if (!data.success) {
            throw new Error("Upload failed");
        }
        return data.file;
    }

    /**
     * Clean response text — remove citation refs and normalize formatting.
     * @param {string} text
     * @returns {string}
     */
    cleanText(text) {
        return text
            .replace(/\[(\d+)\]\s*\(#[a-zA-Z0-9_-]+\)/g, "")
            .replace(/\[\d+\]/g, "")
            .replace(/\*\*\*(.+?)\*\*\*/g, "*_$1_*")
            .replace(/\*\*(.+?)\*\*/g, "*$1*")
            .replace(/^###?\s*(.+)/gm, "*$1*")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    /**
     * Parse SSE stream data into structured response
     * @param {string} rawData - Raw SSE response text
     * @returns {object}
     */
    parseSSE(rawData) {
        const lines = rawData.split("\n");
        const result = {
            text: "",
            searchResults: [],
            images: [],
            modelId: null,
            toolCalls: [],
        };

        for (const line of lines) {
            if (!line.startsWith("data: ")) {
                continue;
            }
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
                break;
            }

            try {
                const event = JSON.parse(jsonStr);

                switch (event.type) {
                    case "start":
                        result.modelId = event.messageMetadata?.modelId || null;
                        break;
                    case "text-delta":
                        result.text += event.delta || "";
                        break;
                    case "tool-output-available":
                        if (
                            event.output?.state === "complete" &&
                            !event.preliminary
                        ) {
                            if (event.output.results?.length) {
                                result.searchResults.push(
                                    ...event.output.results.filter(
                                        (r) => r.url && r.title,
                                    ),
                                );
                            }
                            if (event.output.images?.length) {
                                result.images.push(...event.output.images);
                            }
                        }
                        break;
                    case "tool-input-available":
                        result.toolCalls.push({
                            toolName: event.toolName,
                            input: event.input,
                        });
                        break;
                }
            } catch (err) {
                console.error(
                    { err: err.message, line: jsonStr?.slice(0, 100) },
                    "morphic: SSE parse skip",
                );
            }
        }

        result.text = result.text.replace(/```spec[\s\S]*?```\s*$/g, "").trim();
        result.text = this.cleanText(result.text);

        return result;
    }

    /**
     * Download image from URL to buffer
     * @param {string} url - Image URL
     * @returns {Promise<{buffer: Buffer, filename: string, mimetype: string}>}
     */
    async fetchImageFromUrl(url) {
        const response = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 30_000,
            headers: {
                "User-Agent": this.UA,
                Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
                Referer: url,
            },
            maxRedirects: 5,
        });

        const buffer = Buffer.from(response.data);
        const contentType = response.headers["content-type"] || "image/jpeg";
        const mimetype = contentType.split(";")[0].trim();

        if (!mimetype.startsWith("image/")) {
            throw new Error(`URL did not return an image (got ${mimetype})`);
        }

        let filename = "image.jpg";
        const disposition = response.headers["content-disposition"];
        if (disposition) {
            const match = disposition.match(
                /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
            );
            if (match) {
                filename = match[1].replace(/['"]/g, "");
            }
        } else {
            try {
                const urlPath = new URL(url).pathname;
                const base = path.basename(urlPath);
                if (base && /\.\w+$/.test(base)) {
                    filename = base;
                }
            } catch (err) {
                console.error(
                    { err: err.message, url },
                    "morphic: failed to parse filename from URL, using default",
                );
            }
        }

        const extMap = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/gif": ".gif",
            "image/webp": ".webp",
        };
        if (
            extMap[mimetype] &&
            !filename.toLowerCase().endsWith(extMap[mimetype])
        ) {
            filename = filename.replace(/\.\w+$/, "") + extMap[mimetype];
        }

        return { buffer, filename, mimetype };
    }

    /**
     * Send a chat message (text only or text + image)
     * @param {string} text - Message text
     * @param {object} [options]
     * @param {string} [options.chatId] - Existing chat ID (creates new if omitted)
     * @param {"quick"|"adaptive"} [options.mode="adaptive"] - Search mode (quick=flash-lite, adaptive=flash-preview)
     * @param {string} [options.imagePath] - Path to image file
     * @param {Buffer} [options.imageBuffer] - Image buffer
     * @param {string} [options.imageUrl] - Image URL (will be downloaded and uploaded)
     * @param {string} [options.imageFilename] - Filename for buffer upload
     * @param {string} [options.imageMimetype] - MIME type for buffer upload
     * @param {boolean} [options.isNewChat] - Force new/existing chat flag
     * @returns {Promise<object>} { text, searchResults, images, modelId, chatId, toolCalls }
     */
    async chat(text, options = {}) {
        await this.ensureAuth();

        const chatId = options.chatId || this.generateChatId();
        const messageId = this.generateMessageId();
        const isNewChat =
            options.isNewChat !== undefined
                ? options.isNewChat
                : !options.chatId;
        const mode = options.mode || "adaptive";

        const parts = [{ type: "text", text }];

        if (options.imagePath) {
            const uploaded = await this.uploadImage(
                options.imagePath,
                chatId,
                mode,
            );
            parts.push({
                type: "file",
                url: uploaded.url,
                filename: uploaded.filename,
                mediaType: uploaded.mediaType,
            });
        } else if (options.imageBuffer) {
            const uploaded = await this.uploadBuffer(
                options.imageBuffer,
                options.imageFilename || "image.jpg",
                options.imageMimetype || "image/jpeg",
                chatId,
                mode,
            );
            parts.push({
                type: "file",
                url: uploaded.url,
                filename: uploaded.filename,
                mediaType: uploaded.mediaType,
            });
        } else if (options.imageUrl) {
            const { buffer, filename, mimetype } = await this.fetchImageFromUrl(
                options.imageUrl,
            );
            const uploaded = await this.uploadBuffer(
                buffer,
                options.imageFilename || filename,
                options.imageMimetype || mimetype,
                chatId,
                mode,
            );
            parts.push({
                type: "file",
                url: uploaded.url,
                filename: uploaded.filename,
                mediaType: uploaded.mediaType,
            });
        }

        const response = await axios.post(
            `${this.BASE_URL}/api/chat`,
            {
                trigger: "submit-message",
                chatId,
                message: {
                    role: "user",
                    parts,
                    id: messageId,
                },
                isNewChat,
            },
            {
                headers: {
                    "content-type": "application/json",
                    cookie: this.getCookieHeader(mode),
                    origin: this.BASE_URL,
                    referer: `${this.BASE_URL}/search/${chatId}`,
                    "user-agent": this.UA,
                },
                timeout: 60_000,
                responseType: "text",
            },
        );

        const parsed = this.parseSSE(response.data);
        parsed.chatId = chatId;
        return parsed;
    }
}

export default new Morphic();
