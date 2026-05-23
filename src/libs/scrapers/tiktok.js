/**
 * @fileoverview TikTok scraper via tikwm.com (no API key needed).
 * Supports video download (HD with fallback) and search.
 * @module scrapers/tiktok
 */

import axios from "axios";

function parse(d) {
    return {
        id: d.id,
        title: d.title || "",
        cover: d.origin_cover || d.cover || "",
        duration: d.duration || 0,
        video: d.hdplay || d.play || "",
        videoHd: d.hdplay || "",
        videoSd: d.play || "",
        videoWm: d.wmplay || "",
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
 * Check if a video URL is actually reachable (HEAD request).
 * @param {string} videoUrl
 * @returns {Promise<boolean>}
 */
async function isUrlReachable(videoUrl) {
    try {
        const res = await axios.head(videoUrl, {
            timeout: 8_000,
            headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36" },
        });
        return res.status >= 200 && res.status < 400;
    } catch {
        return false;
    }
}

/**
 * Fetch video data from tikwm API.
 * @param {string} url
 * @param {string} hd - "1" or "0"
 */
async function fetchApi(url, hd = "1") {
    const { data } = await axios.post(
        "https://www.tikwm.com/api/",
        new URLSearchParams({ url: url.trim(), hd }).toString(),
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36",
            },
            timeout: 15_000,
        },
    );

    if (data.code !== 0 || !data.data) {
        throw new Error(data.msg || "Failed to fetch TikTok video.");
    }

    return data.data;
}

/**
 * Download a TikTok video by URL.
 * Tries HD first, falls back to SD if the HD CDN returns 502/unavailable.
 * @param {string} url - TikTok video URL
 * @returns {Promise<object>}
 */
export async function download(url) {
    if (!url?.trim()) {
        throw new Error("TikTok URL is required.");
    }

    let d = await fetchApi(url, "1");
    let result = parse(d);

    if (result.video && !result.images) {
        const reachable = await isUrlReachable(result.video);
        if (!reachable && result.videoHd) {
            if (result.videoSd && result.videoSd !== result.videoHd) {
                const sdReachable = await isUrlReachable(result.videoSd);
                if (sdReachable) {
                    result.video = result.videoSd;
                    return result;
                }
            }
            d = await fetchApi(url, "0");
            result = parse(d);
        }
    }

    return result;
}

/**
 * Search TikTok videos by keyword.
 * @param {string} query - Search keywords
 * @param {{ count?: number, cursor?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function search(query, { count = 10, cursor = 0 } = {}) {
    if (!query?.trim()) {
        throw new Error("Search query is required.");
    }

    const { data } = await axios.post(
        "https://www.tikwm.com/api/feed/search",
        new URLSearchParams({
            keywords: query.trim(),
            count: String(count),
            cursor: String(cursor),
            hd: "1",
        }).toString(),
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36",
            },
            timeout: 15_000,
        },
    );

    if (data.code !== 0 || !data.data?.videos?.length) {
        throw new Error(data.msg || "No results found.");
    }

    return data.data.videos.map(parse);
}
