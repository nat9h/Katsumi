/**
 * @fileoverview TikTok scraper using TikTok internal API (xct007 method) as primary,
 * with tikwm as fallback. Supports both video and slideshow posts.
 *
 * Primary: TikTok internal API (api22-normal-c-alisg.tiktokv.com/aweme/v1/feed/)
 * Fallback: tikwm API
 *
 * Based on: https://github.com/xct007/tiktok-scraper/tree/master/src
 * @module scrapers/tiktok
 */

import axios from "axios";

class TikTok {
    UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    TIKWM_API = "https://www.tikwm.com/api/";

    INTERNAL_ENDPOINTS = [
        "https://api22-normal-c-alisg.tiktokv.com",
        "https://api16-normal-useast5.us.tiktokv.com",
        "https://api19-normal-c-useast1a.tiktokv.com",
        "https://api16-normal-c-useast1a.tiktokv.com",
    ];

    /**
     * Generate a random device ID (19 digits).
     * @returns {string}
     */
    deviceId() {
        return Array(19)
            .fill(0)
            .map(() => Math.floor(Math.random() * 10))
            .join("");
    }

    /**
     * Extract video/photo ID from a TikTok URL.
     * Handles short links (vm.tiktok, vt.tiktok) by following redirects.
     * @param {string} url - TikTok URL
     * @returns {Promise<string>} Aweme ID
     */
    async extractId(url) {
        const REGEXP = /(?:video|photo)\/(\d+)/;
        const match = url.match(REGEXP);
        if (match) {
            return match[1];
        }

        if (/(?:vm|vt)\.tiktok\.com/i.test(url)) {
            const resp = await axios.get(url, {
                maxRedirects: 5,
                timeout: 10_000,
                headers: { "User-Agent": this.UA },
                validateStatus: () => true,
            });
            const finalUrl =
                resp.request?.res?.responseUrl ||
                resp.request?._redirectable?._currentUrl ||
                url;
            const m = finalUrl.match(REGEXP);
            if (m) {
                return m[1];
            }
        }

        const numMatch = url.match(/(\d{15,})/);
        if (numMatch) {
            return numMatch[1];
        }

        throw new Error("Could not extract TikTok video ID from URL.");
    }

    /**
     * Fetch aweme data from TikTok internal API.
     * Tries multiple endpoints with rotation.
     * @param {string} awemeId - The video/photo ID
     * @returns {Promise<object>} Raw aweme object
     */
    async fetchInternal(awemeId) {
        let lastError = null;

        for (const baseURL of this.INTERNAL_ENDPOINTS) {
            try {
                const client = axios.create({
                    baseURL,
                    headers: {
                        "Accept-Encoding": "deflate",
                        "User-Agent": "okhttp/3.14.9",
                    },
                });

                const { data } = await client.request({
                    url: "/aweme/v1/feed/",
                    method: "OPTIONS",
                    params: {
                        iid: this.deviceId(),
                        device_id: this.deviceId(),
                        version_code: "300904",
                        aweme_id: awemeId,
                    },
                    timeout: 15_000,
                });

                if (!data?.aweme_list?.length) {
                    continue;
                }

                const aweme = data.aweme_list.find(
                    (item) => item.aweme_id === awemeId,
                );
                if (aweme) {
                    return aweme;
                }
            } catch (err) {
                lastError = err;
            }
        }

        throw lastError || new Error("All internal API endpoints failed.");
    }

    /**
     * Parse raw aweme object from internal API into clean structure.
     * @param {object} aweme - Raw aweme from internal API
     * @returns {object}
     */
    parseInternal(aweme) {
        const video = aweme.video || {};
        const author = aweme.author || {};
        const music = aweme.music || {};
        const statistics = aweme.statistics || {};
        const imagePostInfo = aweme.image_post_info || null;

        const downloadUrls = video.download_addr?.url_list || [];
        const playUrls = video.play_addr?.url_list || [];

        const videoNowm = downloadUrls[0] || playUrls[0] || "";
        const videoPlay = playUrls[0] || "";

        let images = null;
        if (imagePostInfo?.images?.length) {
            images = imagePostInfo.images
                .map(
                    (img) =>
                        img.display_image?.url_list?.[0] ||
                        img.owner_watermark_image?.url_list?.[0] ||
                        "",
                )
                .filter(Boolean);
        }

        const cover =
            video.origin_cover?.url_list?.[0] ||
            video.cover?.url_list?.[0] ||
            "";

        return {
            id: aweme.aweme_id,
            title: aweme.desc || "",
            cover,
            duration: video.duration ? Math.round(video.duration / 1000) : 0,
            video: videoNowm,
            videoHd: videoNowm,
            videoSd: videoPlay,
            music: music.play_url?.url_list?.[0] || "",
            musicInfo: {
                title: music.title || "",
                author: music.author || "",
                album: music.album || "",
                url: music.play_url?.url_list?.[0] || "",
                cover: music.cover_large?.url_list?.[0] || "",
                duration: music.duration || 0,
            },
            author: {
                id: author.uid || "",
                name: author.unique_id || "",
                nickname: author.nickname || "",
                avatar: author.avatar_thumb?.url_list?.[0] || "",
            },
            stats: {
                likes: statistics.digg_count || 0,
                comments: statistics.comment_count || 0,
                shares: statistics.share_count || 0,
                views: statistics.play_count || 0,
                saves: statistics.collect_count || 0,
            },
            images,
            createdAt: aweme.create_time || 0,
        };
    }

    /**
     * Parse tikwm response into the same clean structure.
     * @param {object} d - Raw tikwm response data
     * @returns {object}
     */
    parseTikwm(d) {
        return {
            id: d.id,
            title: d.title || "",
            cover: d.origin_cover || d.cover || "",
            duration: d.duration || 0,
            video: d.hdplay || d.play || "",
            videoHd: d.hdplay || "",
            videoSd: d.play || "",
            music: d.music || "",
            musicInfo: {
                title: d.music_info?.title || "",
                author: d.music_info?.author || "",
                album: d.music_info?.album || "",
                url: d.music_info?.play || "",
                cover: d.music_info?.cover || "",
                duration: d.music_info?.duration || 0,
            },
            author: {
                id: d.author?.id || "",
                name: d.author?.unique_id || "",
                nickname: d.author?.nickname || "",
                avatar: d.author?.avatar || "",
            },
            stats: {
                likes: d.digg_count || 0,
                comments: d.comment_count || 0,
                shares: d.share_count || 0,
                views: d.play_count || 0,
                saves: d.collect_count || 0,
            },
            images: d.images || null,
            createdAt: d.create_time || 0,
        };
    }

    /**
     * Fetch video data from tikwm API (fallback).
     * @param {string} url - TikTok video URL
     * @param {string} [hd="1"] - HD flag
     * @returns {Promise<object>}
     */
    async fetchTikwm(url, hd = "1") {
        const { data } = await axios.post(
            this.TIKWM_API,
            new URLSearchParams({ url: url.trim(), hd }).toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": this.UA,
                },
                timeout: 15_000,
            },
        );

        if (data.code !== 0 || !data.data) {
            throw new Error(data.msg || "Failed to fetch from tikwm.");
        }

        return this.parseTikwm(data.data);
    }

    /**
     * Check if a video URL is actually reachable and has content (HEAD request).
     * @param {string} url
     * @returns {Promise<boolean>}
     */
    async isReachable(url) {
        if (!url) {
            return false;
        }
        try {
            const res = await axios.head(url, {
                timeout: 8_000,
                headers: {
                    "User-Agent": this.UA,
                    Referer: "https://www.tiktok.com/",
                },
            });
            if (res.status < 200 || res.status >= 400) {
                return false;
            }
            const len = Number(res.headers["content-length"] || 0);
            return len > 1000;
        } catch {
            return false;
        }
    }

    /**
     * Download a TikTok video by URL.
     * Strategy:
     * 1. Try internal API (xct007 method) — fast, no watermark, supports slideshow
     * 2. If internal fails, fallback to tikwm
     * @param {string} url - TikTok video URL
     * @returns {Promise<object>}
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("TikTok URL is required.");
        }

        let internalError = null;

        try {
            const awemeId = await this.extractId(url);
            const aweme = await this.fetchInternal(awemeId);
            const result = this.parseInternal(aweme);

            if (result.images?.length) {
                return result;
            }

            if (result.video) {
                const ok = await this.isReachable(result.video);
                if (ok) {
                    return result;
                }

                if (result.videoSd && result.videoSd !== result.video) {
                    const sdOk = await this.isReachable(result.videoSd);
                    if (sdOk) {
                        result.video = result.videoSd;
                        return result;
                    }
                }
                return result;
            }
        } catch (err) {
            internalError = err;
        }

        try {
            let d = await this.fetchTikwm(url, "1");

            if (d.images?.length) {
                return d;
            }

            if (d.video) {
                const hdOk = await this.isReachable(d.video);
                if (hdOk) {
                    return d;
                }

                if (d.videoSd && d.videoSd !== d.video) {
                    const sdOk = await this.isReachable(d.videoSd);
                    if (sdOk) {
                        d.video = d.videoSd;
                        return d;
                    }
                }

                d = await this.fetchTikwm(url, "0");
                if (d.video) {
                    const ok = await this.isReachable(d.video);
                    if (ok) {
                        return d;
                    }
                }
            }
        } catch (err) {
            throw new Error(
                `All sources failed. internal: ${internalError?.message || "unknown"} | tikwm: ${err.message}`,
            );
        }

        throw new Error(
            internalError?.message ||
                "Failed to get video data from all sources.",
        );
    }

    /**
     * Search TikTok videos by keyword (uses tikwm search).
     * @param {string} query - Search keywords
     * @param {{ count?: number, cursor?: number }} [opts]
     * @returns {Promise<object[]>}
     */
    async search(query, { count = 10, cursor = 0 } = {}) {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }

        const { data } = await axios.post(
            `${this.TIKWM_API}feed/search`,
            new URLSearchParams({
                keywords: query.trim(),
                count: String(count),
                cursor: String(cursor),
                hd: "1",
            }).toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": this.UA,
                },
                timeout: 15_000,
            },
        );

        if (data.code !== 0 || !data.data?.videos?.length) {
            throw new Error(data.msg || "No results found.");
        }

        return data.data.videos.map((v) => this.parseTikwm(v));
    }
}

export default new TikTok();
