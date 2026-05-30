/**
 * @fileoverview Reverse image search via Bing Visual Search.
 * No API key required. Uses Bing's internal knowledge endpoint.
 * @module scrapers/lens
 */

import { fileTypeFromBuffer } from "file-type";

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

class Lens {
    /**
     * Reverse image search — returns source pages and similar images.
     * @param {Buffer} buffer - Image buffer (jpg, png, webp, etc.)
     * @returns {Promise<object>} - { sources[], similarImages[] }
     */
    async search(buffer) {
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            throw new Error("Input must be a non-empty buffer.");
        }

        const type = await fileTypeFromBuffer(buffer);
        if (!type?.mime?.startsWith("image/")) {
            throw new Error("Unsupported file type. Must be an image.");
        }

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
                    "User-Agent": UA,
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
    #parseResponse(json) {
        const sources = [];
        const similarImages = [];

        for (const tag of json.tags || []) {
            for (const action of tag.actions || []) {
                if (
                    action.actionType === "PagesIncluding" &&
                    action.data?.value
                ) {
                    for (const item of action.data.value) {
                        sources.push({
                            title: item.name || "",
                            url: item.hostPageUrl || item.contentUrl || "",
                            thumbnail: item.thumbnailUrl || null,
                            domain:
                                item.hostPageDomainFriendlyName ||
                                item.hostPageDisplayUrl?.split("/")[0] ||
                                "",
                        });
                    }
                }

                if (
                    action.actionType === "VisualSearch" &&
                    action.data?.value
                ) {
                    for (const item of action.data.value) {
                        sources.push({
                            title: item.name || "",
                            url: item.hostPageUrl || item.contentUrl || "",
                            thumbnail: item.thumbnailUrl || null,
                            domain:
                                item.hostPageDomainFriendlyName ||
                                item.hostPageDisplayUrl?.split("/")[0] ||
                                "",
                        });
                    }
                }

                if (
                    action.actionType === "SimilarImages" &&
                    action.data?.value
                ) {
                    for (const item of action.data.value) {
                        similarImages.push({
                            url: item.contentUrl || item.hostPageUrl || "",
                            thumbnail: item.thumbnailUrl || null,
                            width: item.width || null,
                            height: item.height || null,
                        });
                    }
                }
            }
        }

        const seen = new Set();
        const uniqueSources = sources.filter((s) => {
            if (!s.url || seen.has(s.url)) {
                return false;
            }
            seen.add(s.url);
            return true;
        });

        return { sources: uniqueSources, similarImages };
    }
}

export default new Lens();
