/**
 * @fileoverview TikTok scraper via tikwm.com (no API key needed).
 * Supports video download (HD) and search.
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
 * Download a TikTok video by URL.
 * @param {string} url - TikTok video URL
 * @returns {Promise<object>}
 */
export async function download(url) {
    if (!url?.trim()) {
        throw new Error("TikTok URL is required.");
    }

    const { data } = await axios.post(
        "https://www.tikwm.com/api/",
        new URLSearchParams({ url: url.trim(), hd: "1" }).toString(),
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent":
                    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36",
            },
            timeout: 15_000,
        },
    );

    if (data.code !== 0 || !data.data) {
        throw new Error(data.msg || "Failed to fetch TikTok video.");
    }

    return parse(data.data);
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
                "User-Agent":
                    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36",
            },
            timeout: 15_000,
        },
    );

    if (data.code !== 0 || !data.data?.videos?.length) {
        throw new Error(data.msg || "No results found.");
    }

    return data.data.videos.map(parse);
}
