/**
 * @fileoverview Remove background scraper via iLoveIMG (no API key needed).
 * @module scrapers/removebg
 */

import { basename } from "node:path";
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import FormData from "form-data";

class RemoveBG {
    static headers = {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        origin: "https://www.iloveimg.com",
        referer: "https://www.iloveimg.com/",
        "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.6844.89 Safari/537.36",
    };

    constructor(options = {}) {
        this.timeout = options.timeout ?? 20_000;
        this.maxRetries = options.maxRetries ?? 1;
        this.session = null;

        this.headers = {
            ...RemoveBG.headers,
            ...(options.headers || {}),
        };

        this.http = axios.create({
            timeout: this.timeout,
            headers: this.headers,
            validateStatus: (status) => status >= 200 && status < 300,
        });
    }

    randomItem(arr = []) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    getNameFromUrl(url, fallbackExt = "jpg") {
        try {
            const pathname = new URL(url).pathname;
            const base = basename(pathname);
            return base && base !== "/" ? base : `image.${fallbackExt}`;
        } catch {
            return `image.${fallbackExt}`;
        }
    }

    async getImageMeta(buffer) {
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            throw new Error("Input must be a buffer.");
        }

        const type = await fileTypeFromBuffer(buffer);
        if (!type?.mime?.startsWith("image/")) {
            throw new Error("Unsupported file.");
        }

        return type;
    }

    parseSessionFromHtml(html) {
        if (typeof html !== "string" || !html.trim()) {
            throw new Error("Empty HTML.");
        }

        const configRaw = html.match(
            /var\s+ilovepdfConfig\s*=\s*({.*?});/s,
        )?.[1];
        if (!configRaw) {
            throw new Error("Config not found.");
        }

        const config = JSON.parse(configRaw);

        const taskId =
            config?.taskId ||
            html.match(/taskId\s*[:=]\s*['"]([a-zA-Z0-9_-]+)['"]/)?.[1] ||
            html.match(/ilovepdfConfig\.taskId\s*=\s*['"](.+?)['"];/)?.[1];

        const token =
            config?.token ||
            html.match(/(eyJ[a-zA-Z0-9._-]+)/)?.[1] ||
            html.match(/Bearer\s+([a-zA-Z0-9._-]+)/i)?.[1];

        const servers = config?.servers;

        if (!taskId) {
            throw new Error("Task ID not found.");
        }
        if (!token) {
            throw new Error("Token not found.");
        }
        if (!Array.isArray(servers) || servers.length === 0) {
            throw new Error("Server list empty.");
        }

        const server = this.randomItem(servers);

        return {
            taskId,
            token,
            server,
            baseURL: `https://${server}.iloveimg.com`,
        };
    }

    async initSession(force = false) {
        if (this.session && !force) {
            return this.session;
        }

        const { data: html } = await this.http.get(
            "https://www.iloveimg.com/remove-background",
        );

        this.session = this.parseSessionFromHtml(html);
        return this.session;
    }

    createUploadForm({ buffer, filename, mime, taskId }) {
        const form = new FormData();
        form.append("name", filename);
        form.append("chunk", "0");
        form.append("chunks", "1");
        form.append("task", taskId);
        form.append("preview", "1");
        form.append("pdfinfo", "0");
        form.append("pdfforms", "0");
        form.append("pdfresetforms", "0");
        form.append("v", "web.0");
        form.append("file", buffer, { filename, contentType: mime });
        return form;
    }

    createRemoveForm({ taskId, serverFilename }) {
        const form = new FormData();
        form.append("task", taskId);
        form.append("server_filename", serverFilename);
        return form;
    }

    async upload(buffer, filename = "image") {
        const session = await this.initSession();
        const { mime, ext } = await this.getImageMeta(buffer);

        const finalName = /\.[a-z0-9]+$/i.test(filename)
            ? filename
            : `${filename}.${ext}`;

        const form = this.createUploadForm({
            buffer,
            filename: finalName,
            mime,
            taskId: session.taskId,
        });

        const { data } = await axios.post(
            `${session.baseURL}/v1/upload`,
            form,
            {
                headers: {
                    ...this.headers,
                    ...form.getHeaders(),
                    authorization: `Bearer ${session.token}`,
                },
                timeout: this.timeout,
            },
        );

        if (!data?.server_filename) {
            throw new Error("Upload failed: server_filename is empty.");
        }

        return data.server_filename;
    }

    async remove(serverFilename) {
        if (!serverFilename) {
            throw new Error("Missing server filename.");
        }

        const session = await this.initSession();
        const form = this.createRemoveForm({
            taskId: session.taskId,
            serverFilename,
        });

        const { data } = await axios.post(
            `${session.baseURL}/v1/removebackground`,
            form,
            {
                headers: {
                    ...this.headers,
                    ...form.getHeaders(),
                    authorization: `Bearer ${session.token}`,
                    accept: "*/*",
                },
                responseType: "arraybuffer",
                timeout: this.timeout,
            },
        );

        const result = Buffer.from(data);
        if (!result.length) {
            throw new Error("Empty result.");
        }

        return result;
    }

    async process(buffer, filename = "image") {
        let lastError;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    await this.initSession(true);
                }

                const serverFilename = await this.upload(buffer, filename);
                return await this.remove(serverFilename);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError;
    }

    async fromBuffer(buffer, filename = "image") {
        return this.process(buffer, filename);
    }

    async fromUrl(url) {
        if (!url || typeof url !== "string") {
            throw new Error("Invalid URL.");
        }

        const { data } = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: this.timeout,
            headers: { "user-agent": this.headers["user-agent"] },
        });

        const buffer = Buffer.from(data);
        const { ext } = await this.getImageMeta(buffer);
        const filename = this.getNameFromUrl(url, ext);

        return this.fromBuffer(buffer, filename);
    }
}

export default RemoveBG;
