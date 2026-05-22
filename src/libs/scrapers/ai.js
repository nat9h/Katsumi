/**
 * @fileoverview AI scraper — text & image gen via Pollinations, vision via Groq.
 * Text + Image generation: free, no key (Pollinations.ai).
 * Vision: free tier, needs GROQ_API_KEY (https://console.groq.com).
 * @module scrapers/ai
 */

import axios from "axios";

export class AI {
    constructor({ timeout = 60_000 } = {}) {
        this.timeout = timeout;
    }

    /**
     * Chat with AI (free, no key).
     * @param {string} prompt
     * @param {{ system?: string }} [opts]
     * @returns {Promise<string>}
     */
    async chat(prompt, { system = "" } = {}) {
        if (!prompt?.trim()) {
            throw new Error("Prompt is required.");
        }

        const messages = [];
        if (system) {
            messages.push({ role: "system", content: system });
        }
        messages.push({ role: "user", content: prompt.trim() });

        const { data } = await axios.post(
            "https://text.pollinations.ai/",
            {
                messages,
                model: "openai",
                seed: Math.floor(Math.random() * 100_000),
            },
            {
                headers: { "Content-Type": "application/json" },
                timeout: this.timeout,
                responseType: "text",
            },
        );

        const text = typeof data === "string" ? data : JSON.stringify(data);
        if (!text) {
            throw new Error("No response received from AI.");
        }
        return text.trim();
    }

    /**
     * Analyze an image with AI vision (Groq free tier, needs GROQ_API_KEY).
     * @param {Buffer} buffer
     * @param {{ prompt?: string, mimeType?: string }} [opts]
     * @returns {Promise<string>}
     */
    async vision(
        buffer,
        { prompt = "What is in this image?", mimeType = "image/jpeg" } = {},
    ) {
        const key = process.env.GROQ_API_KEY;
        if (!key) {
            throw new Error(
                "Vision requires GROQ_API_KEY. Get one free at https://console.groq.com",
            );
        }
        if (!buffer || !Buffer.isBuffer(buffer)) {
            throw new Error("Image buffer is required.");
        }

        const url = `data:${mimeType};base64,${buffer.toString("base64")}`;

        const { data } = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url } },
                        ],
                    },
                ],
                max_tokens: 1024,
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${key}`,
                },
                timeout: this.timeout,
            },
        );

        const reply = data?.choices?.[0]?.message?.content;
        if (!reply) {
            throw new Error("No response received from vision AI.");
        }
        return reply.trim();
    }

    /**
     * Generate an image from a text prompt (free, no key).
     * @param {string} prompt
     * @param {{ width?: number, height?: number, enhance?: boolean }} [opts]
     * @returns {Promise<Buffer>}
     */
    async imagine(
        prompt,
        { width = 1024, height = 1024, enhance = true } = {},
    ) {
        if (!prompt?.trim()) {
            throw new Error("Prompt is required.");
        }

        const encoded = encodeURIComponent(prompt.trim());
        const seed = Math.floor(Math.random() * 100_000);
        const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&enhance=${enhance}&nologo=true&seed=${seed}`;

        const { data } = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: this.timeout,
            maxRedirects: 5,
        });

        if (!data?.length) {
            throw new Error("No image generated.");
        }
        return Buffer.from(data);
    }
}

export default AI;

let _instance;
export function getAI(opts) {
    if (!_instance) {
        _instance = new AI(opts);
    }
    return _instance;
}
