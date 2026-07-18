/**
 * @fileoverview Image-to-image AI transformation via toimage.app (no API key needed).
 * @module scrapers/img2img
 */

import { randomUUID } from "node:crypto";

const getRandomUserAgent = () => {
    const versions = ["133.0.0.0", "134.0.0.0", "135.0.0.0"];
    const version = versions[Math.floor(Math.random() * versions.length)];
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
};

export class Image2Image {
    constructor() {
        this.refreshIdentity();
    }

    refreshIdentity() {
        this.visitorId = randomUUID();
        this.userAgent = getRandomUserAgent();
    }

    getHeaders(extra = {}) {
        return {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            origin: "https://toimage.app",
            referer: "https://toimage.app/",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "user-agent": this.userAgent,
            "visitor-id": this.visitorId,
            ...extra,
        };
    }

    async generateImage(uploadedImageUrl, prompt) {
        const response = await fetch(
            "https://toimage.app/api/task/image/generate",
            {
                method: "POST",
                headers: this.getHeaders({
                    "content-type": "application/json",
                }),
                body: JSON.stringify({
                    type: "image-to-image",
                    prompt,
                    num: 1,
                    ratio: "auto",
                    images: [uploadedImageUrl],
                    model: "base",
                }),
            },
        );

        const result = await response.json();

        if (result.message?.includes("generated 3 images")) {
            this.refreshIdentity();
            throw new Error("RETRY_WITH_NEW_IDENTITY");
        }

        return result;
    }

    async pollTaskStatus(taskId, timeoutMs = 120_000) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const response = await fetch(
                "https://toimage.app/api/task/recent?type=image-to-image",
                { headers: this.getHeaders() },
            );
            const { data } = await response.json();
            const task = data?.find((t) => t.taskId === taskId);

            if (task?.status === "completed") {
                return task.returnValue.images[0];
            }
            if (task?.status === "failed") {
                throw new Error("Image generation failed.");
            }

            await new Promise((r) => setTimeout(r, 3000));
        }

        throw new Error("Image generation timed out.");
    }

    async process(imageUrl, prompt, maxRetries = 1) {
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    this.refreshIdentity();
                }

                const taskResult = await this.generateImage(imageUrl, prompt);

                if (taskResult.code !== 200) {
                    throw new Error(taskResult.message || "Generate failed.");
                }

                const resultUrl = await this.pollTaskStatus(
                    taskResult.data.taskId,
                );

                const resultBuffer = await this.fetchResultBuffer(resultUrl);

                return { url: resultUrl, buffer: resultBuffer };
            } catch (error) {
                lastError = error;
                if (error.message !== "RETRY_WITH_NEW_IDENTITY") {
                    throw error;
                }
            }
        }

        throw lastError;
    }

    async fetchResultBuffer(resultUrl) {
        const proxied = `https://images.weserv.nl/?url=${resultUrl.replace(/^https?:\/\//, "")}`;
        const res = await fetch(proxied);
        if (!res.ok) {
            throw new Error(
                `Failed to download result via proxy (${res.status}): ${await res
                    .text()
                    .catch(() => "")
                    .slice(0, 200)}`,
            );
        }
        return Buffer.from(await res.arrayBuffer());
    }
}

export default Image2Image;
