/**
 * @fileoverview Image upscaler via imgupscaler.com (no API key needed).
 * @module scrapers/upscale
 */

export class Upscaler {
    constructor({
        scaleRadio = 2,
        pollIntervalMs = 3000,
        timeoutMs = 120_000,
    } = {}) {
        this.scaleRadio = scaleRadio;
        this.pollIntervalMs = pollIntervalMs;
        this.timeoutMs = timeoutMs;
    }

    async #safeJson(response) {
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
        }
    }

    async #downloadImage(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.status}`);
        }
        const contentType =
            response.headers.get("content-type") || "image/jpeg";
        const buffer = Buffer.from(await response.arrayBuffer());
        return { buffer, contentType };
    }

    async #uploadImage(image, contentType, scaleRadio) {
        const formData = new FormData();
        formData.append(
            "myfile",
            new File([image], "image.jpg", { type: contentType }),
        );
        formData.append("scaleRadio", String(scaleRadio));

        const response = await fetch(
            "https://get1.imglarger.com/api/UpscalerNew/UploadNew",
            {
                method: "POST",
                headers: {
                    accept: "application/json, text/plain, */*",
                    origin: "https://imgupscaler.com",
                    referer: "https://imgupscaler.com/",
                    "user-agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
                },
                body: formData,
            },
        );

        const result = await this.#safeJson(response);
        if (result.code !== 200 || !result?.data?.code) {
            throw new Error(
                `Upload error: ${JSON.stringify(result).slice(0, 200)}`,
            );
        }

        return result.data.code;
    }

    async #checkStatus(code, scaleRadio) {
        const response = await fetch(
            "https://get1.imglarger.com/api/UpscalerNew/CheckStatusNew",
            {
                method: "POST",
                headers: {
                    accept: "application/json, text/plain, */*",
                    "content-type": "application/json",
                    origin: "https://imgupscaler.com",
                    referer: "https://imgupscaler.com/",
                    "user-agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
                },
                body: JSON.stringify({ code, scaleRadio }),
            },
        );

        const result = await this.#safeJson(response);
        if (result.code !== 200) {
            throw new Error(
                `Status error: ${JSON.stringify(result).slice(0, 200)}`,
            );
        }
        return result;
    }

    async #pollStatus(code, scaleRadio) {
        const start = Date.now();

        while (Date.now() - start < this.timeoutMs) {
            const result = await this.#checkStatus(code, scaleRadio);
            const data = result.data || {};
            const status = data.status;
            const urls = data.downloadUrls || [];

            if (status === "success") {
                if (!urls.length || !urls[0]) {
                    throw new Error("Success but download URL is empty.");
                }
                return urls[0];
            }

            if (status === "failed" || status === "error") {
                throw new Error(
                    `Upscale failed: ${JSON.stringify(result).slice(0, 200)}`,
                );
            }

            await new Promise((r) => setTimeout(r, this.pollIntervalMs));
        }

        throw new Error(`Upscale timed out after ${this.timeoutMs}ms.`);
    }

    async upscaleFromUrl(url, scaleRadio = this.scaleRadio) {
        const { buffer, contentType } = await this.#downloadImage(url);
        const code = await this.#uploadImage(buffer, contentType, scaleRadio);
        const resultUrl = await this.#pollStatus(code, scaleRadio);
        const response = await fetch(resultUrl);
        if (!response.ok) {
            throw new Error(`Failed to download result: ${response.status}`);
        }
        const resultBuffer = Buffer.from(await response.arrayBuffer());
        return { code, resultUrl, buffer: resultBuffer };
    }

    async upscaleFromBuffer(buffer, scaleRadio = this.scaleRadio) {
        const code = await this.#uploadImage(buffer, "image/jpeg", scaleRadio);
        const resultUrl = await this.#pollStatus(code, scaleRadio);
        const response = await fetch(resultUrl);
        if (!response.ok) {
            throw new Error(`Failed to download result: ${response.status}`);
        }
        const resultBuffer = Buffer.from(await response.arrayBuffer());
        return { code, resultUrl, buffer: resultBuffer };
    }
}

export default Upscaler;
