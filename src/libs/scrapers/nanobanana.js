/**
 * @fileoverview NanoBanana AI image generation scraper.
 * Uses temp email + Supabase OTP for free 20 credits per account.
 * Supports multiple temp mail providers as fallback.
 * @module scrapers/nanobanana
 */

import { randomUUID } from "node:crypto";

export class NanoBanana {
    static supa = "https://gfoafqcjhfqigdwtxwqt.supabase.co";
    static anonKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdmb2FmcWNqaGZxaWdkd3R4d3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTY1NDksImV4cCI6MjA3MDkzMjU0OX0.Qe1pmu-LTkQNqNjKEqcARyfqhtlL758eu2gakrz66Og";
    static baseURL = "https://nanobananaimg.com";
    static UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
    static models = {
        "nano-banana": { endpoint: "/api/image/kie/generate", credits: 10 },
        "nano-banana-edit": {
            endpoint: "/api/image/kie/generate",
            credits: 10,
        },
        "nano-banana-2": { endpoint: "/api/image/kie/generate", credits: 15 },
        "nano-banana-pro": { endpoint: "/api/image/kie/generate", credits: 20 },
    };
    static tempProviders = ["tempMailLol", "mailTm", "akunlama"];

    constructor() {
        this.cookie = null;
        this.email = null;
    }

    static providers = {
        async mailTm() {
            const API = "https://api.mail.tm";
            const domRes = await fetch(`${API}/domains`, {
                headers: { accept: "application/json" },
            });
            if (!domRes.ok) {
                throw new Error("mail.tm domains unavailable");
            }
            const domData = await domRes.json();
            const domains = domData["hydra:member"] || domData;
            if (!domains?.length) {
                throw new Error("mail.tm: no domains");
            }

            const domain = domains[0].domain;
            const username = `nb${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
            const address = `${username}@${domain}`;
            const password = `P${randomUUID().slice(0, 12)}!`;

            const accRes = await fetch(`${API}/accounts`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ address, password }),
            });
            if (!accRes.ok) {
                throw new Error(`mail.tm account failed: ${accRes.status}`);
            }

            const tokRes = await fetch(`${API}/token`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ address, password }),
            });
            if (!tokRes.ok) {
                throw new Error("mail.tm token failed");
            }
            const { token } = await tokRes.json();

            return {
                address,
                async waitForEmail(timeoutMs = 90_000) {
                    const start = Date.now();
                    while (Date.now() - start < timeoutMs) {
                        const res = await fetch(`${API}/messages`, {
                            headers: { authorization: `Bearer ${token}` },
                        });
                        if (res.ok) {
                            const data = await res.json();
                            const msgs = data["hydra:member"] || data;
                            if (msgs.length > 0) {
                                const msgRes = await fetch(
                                    `${API}/messages/${msgs[0].id}`,
                                    {
                                        headers: {
                                            authorization: `Bearer ${token}`,
                                        },
                                    },
                                );
                                if (msgRes.ok) {
                                    const msg = await msgRes.json();
                                    return `${msg.html?.[0] || ""} ${msg.text || ""}`;
                                }
                            }
                        }
                        await new Promise((r) => setTimeout(r, 3000));
                    }
                    throw new Error("mail.tm: timeout");
                },
            };
        },

        async tempMailLol() {
            const createRes = await fetch(
                "https://api.tempmail.lol/v2/inbox/create",
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                },
            );
            if (!createRes.ok) {
                throw new Error("tempmail.lol create failed");
            }
            const { address, token } = await createRes.json();

            return {
                address,
                async waitForEmail(timeoutMs = 90_000) {
                    const start = Date.now();
                    while (Date.now() - start < timeoutMs) {
                        const res = await fetch(
                            `https://api.tempmail.lol/v2/inbox?token=${token}`,
                        );
                        if (res.ok) {
                            const data = await res.json();
                            if (data.emails?.length > 0) {
                                const email = data.emails[0];
                                return `${email.html || ""} ${email.body || ""}`;
                            }
                        }
                        await new Promise((r) => setTimeout(r, 3000));
                    }
                    throw new Error("tempmail.lol: timeout");
                },
            };
        },

        async akunlama() {
            const name = `nb${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
            const address = `${name}@akunlama.com`;

            return {
                address,
                async waitForEmail(timeoutMs = 90_000) {
                    const start = Date.now();
                    while (Date.now() - start < timeoutMs) {
                        const res = await fetch(
                            `https://akunlama.com/api/v1/mail/list?recipient=${encodeURIComponent(address)}`,
                        );
                        if (res.ok) {
                            const data = await res.json();
                            if (data.length > 0) {
                                const mailKey =
                                    data[0].key || data[0].id || data[0].url;
                                if (mailKey) {
                                    const mailRes = await fetch(
                                        `https://akunlama.com/api/v1/mail/read?key=${encodeURIComponent(mailKey)}`,
                                    );
                                    if (mailRes.ok) {
                                        const mailData = await mailRes.json();
                                        return `${mailData.html || ""} ${mailData.text || ""} ${mailData["body-html"] || ""} ${mailData["body-plain"] || ""} ${data[0].preview || ""}`;
                                    }
                                }
                                return (
                                    data[0].preview || JSON.stringify(data[0])
                                );
                            }
                        }
                        await new Promise((r) => setTimeout(r, 3000));
                    }
                    throw new Error("akunlama: timeout");
                },
            };
        },
    };

    async #createTempMail() {
        const errors = [];
        for (const name of NanoBanana.tempProviders) {
            try {
                return await NanoBanana.providers[name]();
            } catch (err) {
                errors.push(`${name}: ${err.message}`);
            }
        }
        throw new Error(`All mail providers failed: ${errors.join("; ")}`);
    }

    async register() {
        const mail = await this.#createTempMail();
        this.email = mail.address;

        const otpRes = await fetch(`${NanoBanana.supa}/auth/v1/otp`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                apikey: NanoBanana.anonKey,
                authorization: `Bearer ${NanoBanana.anonKey}`,
            },
            body: JSON.stringify({ email: mail.address }),
        });
        if (!otpRes.ok) {
            throw new Error(`OTP request failed: ${otpRes.status}`);
        }

        const emailContent = await mail.waitForEmail(90_000);
        const tokenHash = emailContent.match(/token_hash=([a-f0-9]+)/)?.[1];
        const type = emailContent.match(/type=([a-z_]+)/)?.[1] || "email";

        if (!tokenHash) {
            throw new Error("Could not extract token_hash from email.");
        }

        const verifyRes = await fetch(`${NanoBanana.supa}/auth/v1/verify`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                apikey: NanoBanana.anonKey,
                authorization: `Bearer ${NanoBanana.anonKey}`,
            },
            body: JSON.stringify({ token_hash: tokenHash, type }),
        });

        const session = await verifyRes.json();
        if (!session.access_token) {
            throw new Error("Verification failed: no access token.");
        }

        const sessionObj = {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            token_type: "bearer",
            expires_in: session.expires_in || 3600,
            expires_at:
                session.expires_at || Math.floor(Date.now() / 1000) + 3600,
            user: session.user,
        };
        this.cookie = `sb-gfoafqcjhfqigdwtxwqt-auth-token=${encodeURIComponent(JSON.stringify(sessionObj))}`;

        return { email: mail.address, credits: 20 };
    }

    #getHeaders(extra = {}) {
        return {
            "user-agent": NanoBanana.UA,
            origin: NanoBanana.baseURL,
            referer: `${NanoBanana.baseURL}/studio/image-to-image`,
            cookie: this.cookie,
            ...extra,
        };
    }

    async #uploadImage(buffer) {
        const filename = `${randomUUID()}.png`;
        const boundary = `----WebKitFormBoundary${randomUUID().replace(/-/g, "").slice(0, 16)}`;

        const body = Buffer.concat([
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
            ),
            buffer,
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        const res = await fetch(`${NanoBanana.baseURL}/api/upload`, {
            method: "POST",
            headers: this.#getHeaders({
                "content-type": `multipart/form-data; boundary=${boundary}`,
            }),
            body,
        });

        if (!res.ok) {
            const presignRes = await fetch(
                `${NanoBanana.baseURL}/api/upload/presign`,
                {
                    method: "POST",
                    headers: this.#getHeaders({
                        "content-type": "application/json",
                    }),
                    body: JSON.stringify({
                        filename,
                        contentType: "image/png",
                    }),
                },
            );

            if (!presignRes.ok) {
                throw new Error("Image upload failed.");
            }

            const { url: uploadUrl, publicUrl } = await presignRes.json();
            await fetch(uploadUrl, {
                method: "PUT",
                headers: { "content-type": "image/png" },
                body: buffer,
            });
            return publicUrl;
        }

        const data = await res.json();
        return data.url || data.publicUrl || data.imageUrl;
    }

    async #pollTask(taskId, timeoutMs = 120_000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            await new Promise((r) => setTimeout(r, 4000));

            const res = await fetch(
                `${NanoBanana.baseURL}/api/image/task-status?taskId=${taskId}`,
                { headers: this.#getHeaders() },
            );

            if (!res.ok) {
                continue;
            }
            const data = await res.json();
            const status = data.status || data.state;

            if (status === "completed" || status === "success") {
                const imageUrl =
                    data.imageUrls?.[0] ||
                    data.images?.[0] ||
                    data.output?.[0] ||
                    data.result;
                if (!imageUrl) {
                    throw new Error("Task completed but no image URL found.");
                }
                return imageUrl;
            }

            if (status === "failed" || status === "error") {
                throw new Error(
                    `Generation failed: ${data.error || data.message || "unknown"}`,
                );
            }
        }
        throw new Error("Generation timed out.");
    }

    /**
     * Generate image (text-to-image)
     * @param {string} prompt - Text prompt
     * @param {object} [options] - Generation options
     * @param {string} [options.model="nano-banana"] - Model ID
     * @param {string} [options.resolution="1K"] - Resolution (1K, 2K, 4K)
     * @param {string} [options.format="png"] - Output format (png, jpg)
     * @param {string} [options.aspectRatio="1:1"] - Aspect ratio
     * @returns {Promise<{url: string, buffer: Buffer}>}
     */
    async textToImage(prompt, options = {}) {
        if (!this.cookie) {
            throw new Error("Not authenticated. Call register() first.");
        }

        const {
            model = "nano-banana",
            resolution = "1K",
            format = "png",
            aspectRatio = "1:1",
        } = options;
        const modelInfo = NanoBanana.models[model];
        if (!modelInfo) {
            throw new Error(
                `Unknown model: ${model}. Available: ${Object.keys(NanoBanana.models).join(", ")}`,
            );
        }

        const res = await fetch(`${NanoBanana.baseURL}${modelInfo.endpoint}`, {
            method: "POST",
            headers: this.#getHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({
                modelId: model,
                prompt,
                num: 1,
                resolution,
                outputFormat: format,
                aspectRatio,
            }),
        });

        if (!res.ok) {
            throw new Error(
                `Generate failed (${res.status}): ${await res.text()}`,
            );
        }

        const data = await res.json();
        if (!data.taskId) {
            throw new Error(`No taskId: ${JSON.stringify(data)}`);
        }

        const imageUrl = await this.#pollTask(data.taskId);
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
            throw new Error("Failed to download result image.");
        }

        return {
            url: imageUrl,
            buffer: Buffer.from(await imgRes.arrayBuffer()),
        };
    }

    /**
     * Generate image (image-to-image)
     * @param {Buffer} imageBuffer - Input image buffer
     * @param {string} prompt - Edit prompt
     * @param {object} [options] - Generation options
     * @param {string} [options.model="nano-banana-edit"] - Model ID
     * @param {string} [options.resolution="1K"] - Resolution
     * @param {string} [options.format="png"] - Output format
     * @param {string} [options.aspectRatio="auto"] - Aspect ratio
     * @returns {Promise<{url: string, buffer: Buffer}>}
     */
    async imageToImage(imageBuffer, prompt, options = {}) {
        if (!this.cookie) {
            throw new Error("Not authenticated. Call register() first.");
        }

        const {
            model = "nano-banana-edit",
            resolution = "1K",
            format = "png",
            aspectRatio = "auto",
        } = options;
        const modelInfo =
            NanoBanana.models[model] || NanoBanana.models["nano-banana-edit"];
        const imageUrl = await this.#uploadImage(imageBuffer);

        const res = await fetch(`${NanoBanana.baseURL}${modelInfo.endpoint}`, {
            method: "POST",
            headers: this.#getHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({
                modelId: model,
                prompt,
                num: 1,
                resolution,
                outputFormat: format,
                aspectRatio,
                images: [imageUrl],
            }),
        });

        if (!res.ok) {
            throw new Error(
                `Generate failed (${res.status}): ${await res.text()}`,
            );
        }

        const data = await res.json();
        if (!data.taskId) {
            throw new Error(`No taskId: ${JSON.stringify(data)}`);
        }

        const resultUrl = await this.#pollTask(data.taskId);
        const imgRes = await fetch(resultUrl);
        if (!imgRes.ok) {
            throw new Error("Failed to download result image.");
        }

        return {
            url: resultUrl,
            buffer: Buffer.from(await imgRes.arrayBuffer()),
        };
    }

    /**
     * High-level: create account + generate in one call
     * @param {Buffer|null} imageBuffer - Input image (null for text-to-image)
     * @param {string} prompt - Text prompt
     * @param {object} [options] - Options
     * @returns {Promise<{url: string, buffer: Buffer}>}
     */
    async process(imageBuffer, prompt, options = {}) {
        await this.register();
        if (imageBuffer) {
            return await this.imageToImage(imageBuffer, prompt, options);
        }
        return await this.textToImage(prompt, options);
    }
}

export default NanoBanana;
