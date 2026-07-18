/**
 * @fileoverview Reverse image search via Bing Visual Search.
 * No API key required. Uses Bing's internal knowledge endpoint.
 * @module scrapers/lens
 */

import { fileTypeFromBuffer } from "file-type";

class Lens {
    /**
     * Reverse image search — returns source pages and similar images.
     * @param {Buffer} buffer - Image buffer (jpg, png, webp, etc.)
     * @returns {Promise<object>} - { sources[], similarImages[] }
     */
    async search(buffer, { retries = 3 } = {}) {
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            throw new Error("Input must be a non-empty buffer.");
        }

        const type = await fileTypeFromBuffer(buffer);
        if (!type?.mime?.startsWith("image/")) {
            throw new Error("Unsupported file type. Must be an image.");
        }

        let lastResult = { sources: [], similarImages: [] };
        for (let attempt = 0; attempt < retries; attempt++) {
            const parsed = await this.#doSearch(buffer, type);
            if (parsed.sources.length || parsed.similarImages.length) {
                return parsed;
            }
            lastResult = parsed;
            if (attempt < retries - 1) {
                await new Promise((r) => setTimeout(r, 800));
            }
        }
        return lastResult;
    }

    async #doSearch(buffer, type) {
        const form = new FormData();
        form.append(
            "knowledgeRequest",
            JSON.stringify({
                imageInfo: {},
                knowledgeRequest: {
                    invokedSkills: [
                        "SimilarImages",
                        "PagesIncluding",
                        "ObjectDetection",
                    ],
                    invokedSkillsRequestData: {
                        enableEntityData: true,
                    },
                },
            }),
        );
        form.append(
            "image",
            new Blob([buffer], { type: type.mime }),
            `image.${type.ext}`,
        );

        const res = await fetch(
            "https://www.bing.com/images/api/custom/knowledge",
            {
                method: "POST",
                body: form,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
                    Accept: "application/json",
                    Referer: "https://www.bing.com/images/search",
                },
                signal: AbortSignal.timeout(20_000),
            },
        );

        if (!res.ok) {
            throw new Error(`Bing Visual Search failed (${res.status}).`);
        }

        const json = await res.json();
        return this.#parseResponse(json);
    }

    /**
     * Parse Bing Visual Search JSON response.
     * @param {object} json
     * @returns {object}
     */
    #extractDomain(item) {
        if (item.hostPageDomainFriendlyName) {
            return item.hostPageDomainFriendlyName;
        }
        const raw = item.hostPageUrl || item.hostPageDisplayUrl || "";
        try {
            return new URL(raw).hostname.replace(/^www\./, "");
        } catch {
            return "";
        }
    }

    #parseResponse(json) {
        const sources = [];
        const similarImages = [];

        for (const tag of json.tags || []) {
            for (const action of tag.actions || []) {
                const items = action.data?.value;
                if (!Array.isArray(items) || !items.length) {
                    continue;
                }

                if (action.actionType === "PagesIncluding") {
                    for (const item of items) {
                        sources.push({
                            title: item.name || "",
                            url: item.hostPageUrl || item.contentUrl || "",
                            thumbnail: item.thumbnailUrl || null,
                            domain: this.#extractDomain(item),
                        });
                    }
                } else if (
                    action.actionType === "VisualSearch" ||
                    action.actionType === "SimilarImages"
                ) {
                    for (const item of items) {
                        similarImages.push({
                            title: item.name || "",
                            url: item.contentUrl || item.hostPageUrl || "",
                            thumbnail: item.thumbnailUrl || null,
                            source: item.hostPageUrl || "",
                            domain: this.#extractDomain(item),
                            width: item.width || null,
                            height: item.height || null,
                        });
                    }
                }
            }
        }

        const dedupe = (arr, key) => {
            const seen = new Set();
            return arr.filter((x) => {
                const v = x[key];
                if (!v || seen.has(v)) {
                    return false;
                }
                seen.add(v);
                return true;
            });
        };

        return {
            sources: dedupe(sources, "url"),
            similarImages: dedupe(similarImages, "url"),
        };
    }
}

export default new Lens();
