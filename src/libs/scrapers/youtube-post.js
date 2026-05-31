/**
 * @fileoverview YouTube community post scraper.
 * Extracts text, images, videos, and metadata from YouTube posts.
 * @module scrapers/youtube-post
 */

import axios from "axios";

class YouTubePost {
    UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    /**
     * Extract a balanced JSON object/array from a string starting at a given index.
     * @param {string} str
     * @param {number} startIdx
     * @returns {string|null}
     */
    #extractJsonAt(str, startIdx) {
        const open = str[startIdx];
        const close = open === "{" ? "}" : "]";
        let depth = 0;
        let inStr = false;
        let escaped = false;

        for (let i = startIdx; i < str.length; i++) {
            const ch = str[i];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inStr = !inStr;
                continue;
            }
            if (inStr) {
                continue;
            }
            if (ch === open) {
                depth++;
            } else if (ch === close) {
                depth--;
                if (depth === 0) {
                    return str.slice(startIdx, i + 1);
                }
            }
        }
        return null;
    }

    /**
     * Pick the highest-resolution thumbnail from a thumbnails array.
     * Appends =s0 to get original size.
     * @param {Array} thumbnails
     * @returns {{ url: string, width: number, height: number }|null}
     */
    #bestThumbnail(thumbnails) {
        if (!thumbnails?.length) {
            return null;
        }
        const best = thumbnails[thumbnails.length - 1];
        const url = best.url?.split("=s")[0] + "=s0";
        return { url, width: best.width, height: best.height };
    }

    /**
     * Download/scrape a YouTube community post.
     * @param {string} url - YouTube post URL (youtube.com/post/xxx)
     * @returns {Promise<object>} Post data
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("YouTube post URL is required.");
        }

        if (!/youtube\.com\/post\//i.test(url)) {
            throw new Error("Invalid YouTube post URL.");
        }

        const { data: html } = await axios.get(url.trim(), {
            headers: {
                "User-Agent": this.UA,
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout: 15_000,
        });

        const initMatch = html.match(/var ytInitialData\s*=\s*/);
        if (!initMatch) {
            throw new Error("Could not find ytInitialData.");
        }

        const jsonStart = initMatch.index + initMatch[0].length;
        const jsonStr = this.#extractJsonAt(html, jsonStart);
        if (!jsonStr) {
            throw new Error("Could not parse ytInitialData.");
        }

        const data = JSON.parse(jsonStr);
        const fullJson = JSON.stringify(data);

        if (!fullJson.includes("backstagePostRenderer")) {
            throw new Error("No community post found on this page.");
        }

        const bprIdx =
            fullJson.indexOf('"backstagePostRenderer":{') +
            '"backstagePostRenderer":'.length;
        const bprJson = this.#extractJsonAt(fullJson, bprIdx);
        const post = JSON.parse(bprJson);

        return this.#parsePost(post);
    }

    /**
     * Parse a backstagePostRenderer object into a clean result.
     * @param {object} post
     * @returns {object}
     */
    #parsePost(post) {
        // Author
        const author = post.authorText?.runs?.[0]?.text || "Unknown";
        const authorThumbs = post.authorThumbnail?.thumbnails || [];
        const avatar = authorThumbs[authorThumbs.length - 1]?.url || "";

        // Text content
        const textRuns = post.contentText?.runs || [];
        const text = textRuns.map((r) => r.text).join("");

        // Images
        const images = this.#extractImages(post);

        // Videos
        const videos = this.#extractVideos(post);

        // Poll
        const poll = this.#extractPoll(post);

        // Likes
        const likes = post.voteCount?.simpleText || "0";

        // Post ID
        const postId = post.postId || "";

        return { postId, author, avatar, text, images, videos, poll, likes };
    }

    /**
     * Extract images from a post (single or carousel).
     * @param {object} post
     * @returns {Array<{ url: string, width: number, height: number }>}
     */
    #extractImages(post) {
        const images = [];
        const att = post.backstageAttachment;

        if (!att) {
            return images;
        }

        // Single image
        if (att.backstageImageRenderer) {
            const thumb = this.#bestThumbnail(
                att.backstageImageRenderer.image?.thumbnails,
            );
            if (thumb) {
                images.push(thumb);
            }
        }

        // Multiple images (carousel)
        if (att.postMultiImageRenderer?.images) {
            for (const img of att.postMultiImageRenderer.images) {
                const thumb = this.#bestThumbnail(
                    img.backstageImageRenderer?.image?.thumbnails,
                );
                if (thumb) {
                    images.push(thumb);
                }
            }
        }

        return images;
    }

    /**
     * Extract video attachment from a post.
     * @param {object} post
     * @returns {Array<{ id: string, url: string, title: string, duration: string }>}
     */
    #extractVideos(post) {
        const videos = [];
        const att = post.backstageAttachment;

        if (!att?.videoRenderer) {
            return videos;
        }

        const vid = att.videoRenderer;
        videos.push({
            id: vid.videoId,
            url: `https://www.youtube.com/watch?v=${vid.videoId}`,
            title: vid.title?.runs?.[0]?.text || "",
            duration: vid.lengthText?.simpleText || "",
        });

        return videos;
    }

    /**
     * Extract poll data from a post.
     * @param {object} post
     * @returns {object|null}
     */
    #extractPoll(post) {
        const att = post.backstageAttachment;
        const pollRenderer = att?.pollRenderer;

        if (!pollRenderer) {
            return null;
        }

        const choices = (pollRenderer.choices || []).map((c) => ({
            text: c.text?.runs?.map((r) => r.text).join("") || "",
            image: this.#bestThumbnail(c.image?.thumbnails),
        }));

        return { totalVotes: pollRenderer.totalVotes || "0", choices };
    }
}

export default new YouTubePost();
