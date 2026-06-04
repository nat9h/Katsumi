/**
 * @fileoverview Instagram downloader via GraphQL API.
 * Requires IG_SESSION_ID in .env for authenticated access.
 * @module scrapers/instagram
 */

import axios from "axios";

class Instagram {
    #ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    DOC_ID = "8845758582119845";

    /**
     * Extract shortcode from a post/reel URL.
     * @param {string} url
     * @returns {string|null}
     */
    extractShortcode(url) {
        return (
            url.match(
                /(?:instagram\.com|instagr\.am)\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/,
            )?.[1] || null
        );
    }

    /**
     * Extract story media ID from a story URL.
     * @param {string} url
     * @returns {{username: string, storyId: string}|null}
     */
    extractStory(url) {
        const match = url.match(
            /instagram\.com\/stories\/(?!highlights\/)([^/?]+)\/(\d+)/,
        );
        if (!match) {
            return null;
        }
        return { username: match[1], storyId: match[2] };
    }

    /**
     * Extract highlight ID from a highlight URL.
     * @param {string} url
     * @returns {string|null}
     */
    extractHighlight(url) {
        const direct = url.match(/instagram\.com\/stories\/highlights\/(\d+)/);
        if (direct) {
            return direct[1];
        }

        const shareMatch = url.match(/instagram\.com\/s\/([A-Za-z0-9_-]+)/);
        if (shareMatch) {
            const decoded = Buffer.from(shareMatch[1], "base64").toString(
                "utf8",
            );
            const hlMatch = decoded.match(/^highlight:(\d+)$/);
            if (hlMatch) {
                return hlMatch[1];
            }
        }

        return null;
    }

    /**
     * Convert a media ID (pk) to a shortcode.
     * @param {string} mediaId
     * @returns {string}
     */
    mediaIdToShortcode(mediaId) {
        const alphabet =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let id = BigInt(mediaId);
        let shortcode = "";
        while (id > 0n) {
            shortcode = alphabet[Number(id % 64n)] + shortcode;
            id = id / 64n;
        }
        return shortcode;
    }

    /**
     * Get session credentials.
     * @returns {{cookies: string, csrf: string}}
     */
    getSession() {
        const sessionId = process.env.IG_SESSION_ID || "";
        if (!sessionId) {
            throw new Error("IG_SESSION_ID required in .env.");
        }

        const dsUserId = process.env.IG_DS_USER_ID || "";
        const mid = process.env.IG_MID || "";
        const igDid = process.env.IG_DID || "";
        const csrf = Math.random().toString(36).slice(2);

        let cookieStr = `sessionid=${sessionId}; csrftoken=${csrf};`;
        if (dsUserId) {
            cookieStr += ` ds_user_id=${dsUserId};`;
        }
        if (mid) {
            cookieStr += ` mid=${mid};`;
        }
        if (igDid) {
            cookieStr += ` ig_did=${igDid};`;
        }

        return { cookies: cookieStr, csrf };
    }

    /**
     * Fetch media data via GraphQL using shortcode.
     * @param {string} shortcode
     * @returns {Promise<object|null>}
     */
    async fetchGraphQL(shortcode) {
        const { cookies, csrf } = this.getSession();

        const { data } = await axios.post(
            "https://www.instagram.com/graphql/query",
            new URLSearchParams({
                doc_id: this.DOC_ID,
                variables: JSON.stringify({
                    shortcode,
                    fetch_tagged_user_count: null,
                    hoisted_comment_id: null,
                    hoisted_reply_id: null,
                }),
            }).toString(),
            {
                headers: {
                    "User-Agent": this.#ua,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-IG-App-ID": "936619743392459",
                    "X-CSRFToken": csrf,
                    Cookie: cookies,
                    Origin: "https://www.instagram.com",
                    Referer: `https://www.instagram.com/p/${shortcode}/`,
                },
                timeout: 15_000,
            },
        );

        return data?.data?.xdt_shortcode_media || null;
    }

    /**
     * Parse comments from GraphQL edges.
     * @param {object} commentData
     * @returns {Array}
     */
    parseComments(commentData) {
        if (!commentData?.edges?.length) {
            return [];
        }

        return commentData.edges.map(({ node }) => ({
            username: node.owner?.username || "",
            avatar: node.owner?.profile_pic_url || "",
            text: node.text || "",
            likes: node.edge_liked_by?.count || 0,
            timestamp: node.created_at || 0,
        }));
    }

    /**
     * Parse GraphQL media into a clean structure.
     * Works for posts, reels, and stories.
     * @param {object} media
     * @returns {object}
     */
    parse(media) {
        const typename = media.__typename || "";
        const isStory = typename.includes("Story");

        const result = {
            shortcode: media.shortcode || "",
            type: typename,
            isVideo: media.is_video || false,
            isStory,
            caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || "",
            author: {
                username: media.owner?.username || "",
                fullName: media.owner?.full_name || "",
                avatar: media.owner?.profile_pic_url || "",
            },
            stats: {
                likes: media.edge_media_preview_like?.count || 0,
                comments: media.edge_media_to_parent_comment?.count || 0,
                views: media.video_view_count || 0,
                plays: media.video_play_count || 0,
            },
            comments: isStory
                ? []
                : this.parseComments(media.edge_media_to_parent_comment),
            media: [],
        };

        if (typename === "XDTGraphSidecar") {
            const edges = media.edge_sidecar_to_children?.edges || [];
            for (const { node } of edges) {
                const videoUrl =
                    node.video_url ||
                    node.video_resources?.[0]?.src ||
                    node.video_versions?.[0]?.url;
                result.media.push({
                    type: node.is_video ? "video" : "image",
                    url:
                        node.is_video && videoUrl ? videoUrl : node.display_url,
                    thumbnail: node.display_url || "",
                    width: node.dimensions?.width || 0,
                    height: node.dimensions?.height || 0,
                });
            }
        } else if (media.is_video) {
            const videoUrl =
                media.video_url ||
                media.video_resources?.[0]?.src ||
                media.video_versions?.[0]?.url;

            if (videoUrl) {
                result.media.push({
                    type: "video",
                    url: videoUrl,
                    thumbnail: media.display_url || media.thumbnail_src || "",
                    width: media.dimensions?.width || 0,
                    height: media.dimensions?.height || 0,
                });
            } else {
                result.media.push({
                    type: "image",
                    url: media.display_url || "",
                    thumbnail: media.display_url || media.thumbnail_src || "",
                    width: media.dimensions?.width || 0,
                    height: media.dimensions?.height || 0,
                });
            }
        } else {
            result.media.push({
                type: "image",
                url: media.display_url || "",
                thumbnail: media.display_url || media.thumbnail_src || "",
                width: media.dimensions?.width || 0,
                height: media.dimensions?.height || 0,
            });
        }

        return result;
    }

    /**
     * Fetch story video URL via REST API (reels_media).
     * @param {string} ownerId
     * @param {string} storyId
     * @param {string} csrf
     * @param {string} cookies
     * @returns {Promise<{url: string, thumbnail: string, width: number, height: number}|null>}
     */
    async fetchStoryVideo(ownerId, storyId, csrf, cookies) {
        try {
            const { data } = await axios.get(
                `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${ownerId}`,
                {
                    headers: {
                        "User-Agent": this.#ua,
                        "X-IG-App-ID": "936619743392459",
                        "X-CSRFToken": csrf,
                        "X-Requested-With": "XMLHttpRequest",
                        Cookie: cookies,
                        Referer: "https://www.instagram.com/",
                    },
                    timeout: 15_000,
                    maxRedirects: 0,
                    validateStatus: (s) => s === 200,
                },
            );

            const reel = data?.reels?.[ownerId];
            const item = reel?.items?.find((i) => String(i.pk) === storyId);
            if (!item?.video_versions?.length) {
                return null;
            }

            return {
                url: item.video_versions[0].url,
                thumbnail: item.image_versions2?.candidates?.[0]?.url || "",
                width: item.original_width || 0,
                height: item.original_height || 0,
            };
        } catch {
            return null;
        }
    }

    /**
     * Fetch highlight items via REST API.
     * @param {string} highlightId - Numeric highlight ID
     * @returns {Promise<object>}
     */
    async fetchHighlight(highlightId) {
        const { cookies, csrf } = this.getSession();
        const reelId = `highlight:${highlightId}`;

        const { data } = await axios.get(
            `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${reelId}`,
            {
                headers: {
                    "User-Agent": this.#ua,
                    "X-IG-App-ID": "936619743392459",
                    "X-CSRFToken": csrf,
                    "X-Requested-With": "XMLHttpRequest",
                    Cookie: cookies,
                    Referer: "https://www.instagram.com/",
                },
                timeout: 15_000,
            },
        );

        const reel = data?.reels?.[reelId];
        if (!reel?.items?.length) {
            throw new Error(
                "Failed to fetch highlight. It may be private or session expired.",
            );
        }

        const media = reel.items.map((item) => {
            const isVideo =
                item.media_type === 2 || !!item.video_versions?.length;
            return {
                type: isVideo ? "video" : "image",
                url: isVideo
                    ? item.video_versions[0].url
                    : item.image_versions2?.candidates?.[0]?.url || "",
                thumbnail: item.image_versions2?.candidates?.[0]?.url || "",
                width: item.original_width || 0,
                height: item.original_height || 0,
            };
        });

        return {
            shortcode: "",
            type: "Highlight",
            isVideo: false,
            isStory: false,
            caption: "",
            title: reel.title || "",
            author: {
                username: reel.user?.username || "",
                fullName: reel.user?.full_name || "",
                avatar: reel.user?.profile_pic_url || "",
            },
            stats: { likes: 0, comments: 0, views: 0, plays: 0 },
            comments: [],
            media,
        };
    }

    /**
     * Download Instagram post/reel/story/highlight by URL.
     * Stories are fetched by converting media ID to shortcode.
     * Highlights are fetched via reels_media endpoint.
     * @param {string} url - Instagram URL
     * @returns {Promise<object>}
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("Instagram URL is required.");
        }

        const clean = url.trim().split("?")[0];

        const highlightId = this.extractHighlight(clean);
        if (highlightId) {
            return this.fetchHighlight(highlightId);
        }

        const { cookies, csrf } = this.getSession();
        let shortcode;

        const storyInfo = this.extractStory(clean);
        if (storyInfo) {
            shortcode = this.mediaIdToShortcode(storyInfo.storyId);
        } else {
            shortcode = this.extractShortcode(clean);
        }

        if (!shortcode) {
            throw new Error(
                "Invalid Instagram URL. Supported: /p/, /reel/, /reels/, /tv/, /stories/, /stories/highlights/",
            );
        }

        const media = await this.fetchGraphQL(shortcode);
        if (!media) {
            throw new Error(
                "Failed to fetch. Post may be private or session expired.",
            );
        }

        if (
            media.__typename?.includes("Story") &&
            media.is_video &&
            media.owner?.id
        ) {
            const videoData = await this.fetchStoryVideo(
                media.owner.id,
                storyInfo?.storyId || "",
                csrf,
                cookies,
            );
            if (videoData) {
                const result = this.parse(media);
                result.media = [
                    {
                        type: "video",
                        url: videoData.url,
                        thumbnail:
                            videoData.thumbnail || media.display_url || "",
                        width: videoData.width || media.dimensions?.width || 0,
                        height:
                            videoData.height || media.dimensions?.height || 0,
                    },
                ];
                return result;
            }
        }

        const result = this.parse(media);
        if (!result.media.length) {
            throw new Error("No downloadable media found.");
        }

        return result;
    }

    /**
     * Search posts by hashtag.
     * @param {string} query - Hashtag (without #)
     * @param {"recent"|"top"} [tab="recent"]
     * @returns {Promise<{tag: string, mediaCount: number, posts: Array}>}
     */
    async searchPosts(query, tab = "recent") {
        if (!query?.trim()) {
            throw new Error("Search query is required.");
        }

        const tag = query.trim().replace(/^#/, "").toLowerCase();
        const { cookies, csrf } = this.getSession();
        const headers = {
            "User-Agent": this.#ua,
            "X-IG-App-ID": "936619743392459",
            "X-CSRFToken": csrf,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookies,
            Referer: `https://www.instagram.com/explore/tags/${tag}/`,
        };

        const { data } = await axios.post(
            `https://www.instagram.com/api/v1/tags/${encodeURIComponent(tag)}/sections/`,
            new URLSearchParams({
                include_persistent: "0",
                tab,
                surface: "grid",
            }).toString(),
            { headers, timeout: 15_000 },
        );

        const sections = data?.sections || [];
        const posts = [];

        for (const section of sections) {
            const medias = section?.layout_content?.medias || [];
            for (const item of medias) {
                const m = item?.media;
                if (!m) {
                    continue;
                }

                const isVideo =
                    m.media_type === 2 || !!m.video_versions?.length;
                posts.push({
                    shortcode: m.code || "",
                    type: isVideo ? "video" : "image",
                    url: isVideo
                        ? m.video_versions?.[0]?.url || ""
                        : m.image_versions2?.candidates?.[0]?.url || "",
                    thumbnail: m.image_versions2?.candidates?.[0]?.url || "",
                    caption: m.caption?.text || "",
                    author: m.user?.username || "",
                    likes: m.like_count || 0,
                    comments: m.comment_count || 0,
                });
            }
        }

        return {
            tag,
            mediaCount: data?.media_count || posts.length,
            posts,
        };
    }
}

export default new Instagram();
