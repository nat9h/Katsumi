/**
 * @fileoverview Instagram downloader via GraphQL API.
 * Requires IG_SESSION_ID in .env for authenticated access.
 * @module scrapers/instagram
 */

import axios from "axios";

class Instagram {
    #ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
     * Convert a shortcode to a media ID (pk).
     * @param {string} shortcode
     * @returns {string}
     */
    shortcodeToMediaId(shortcode) {
        const alphabet =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let id = 0n;
        for (const char of shortcode) {
            id = id * 64n + BigInt(alphabet.indexOf(char));
        }
        return id.toString();
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
     * Fetch media data via REST API using shortcode.
     * @param {string} shortcode
     * @returns {Promise<object|null>}
     */
    async fetchMediaInfo(shortcode) {
        const { cookies, csrf } = this.getSession();
        const mediaId = this.shortcodeToMediaId(shortcode);

        const { data } = await axios.get(
            `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
            {
                headers: {
                    "User-Agent": this.#ua,
                    "X-IG-App-ID": "936619743392459",
                    "X-CSRFToken": csrf,
                    Cookie: cookies,
                },
                timeout: 15_000,
            },
        );

        return data?.items?.[0] || null;
    }

    /**
     * Parse comments from REST API response.
     * @param {Array} comments
     * @returns {Array}
     */
    parseComments(comments) {
        if (!comments?.length) {
            return [];
        }

        return comments.map((c) => ({
            username: c.user?.username || c.pk?.split?.("@")?.[0] || "",
            avatar: c.user?.profile_pic_url || "",
            text: c.text || c.caption || "",
            likes: c.comment_like_count ?? c.like_count ?? 0,
            timestamp: c.created_at ?? c.created_timestamp ?? 0,
        }));
    }

    /**
     * Pick the best image candidate URL.
     * @param {object} item
     * @returns {string}
     */
    #imageUrl(item) {
        return item.image_versions2?.candidates?.[0]?.url || "";
    }

    /**
     * Map a REST API media item to a clean media entry.
     * @param {object} item
     * @returns {{type: string, url: string, thumbnail: string, width: number, height: number}}
     */
    #mapMediaItem(item) {
        const isVideo = item.media_type === 2 || !!item.video_versions?.length;
        return {
            type: isVideo ? "video" : "image",
            url: isVideo ? item.video_versions[0].url : this.#imageUrl(item),
            thumbnail: this.#imageUrl(item),
            width: item.original_width || 0,
            height: item.original_height || 0,
        };
    }

    /**
     * Parse REST API media into a clean structure.
     * Works for posts, reels, and stories.
     * @param {object} media - items[0] from /api/v1/media/{id}/info/
     * @returns {object}
     */
    parse(media) {
        const isStory = !!media.expiring_at;
        const comments = media.comments || media.preview_comments || [];

        const result = {
            shortcode: media.code || "",
            type:
                media.media_type === 8
                    ? "Sidecar"
                    : media.media_type === 2
                      ? "Video"
                      : "Image",
            isVideo: media.media_type === 2 || !!media.video_versions?.length,
            isStory,
            caption: media.caption?.text || "",
            author: {
                username: media.user?.username || "",
                fullName: media.user?.full_name || "",
                avatar: media.user?.profile_pic_url || "",
            },
            stats: {
                likes: media.like_count || 0,
                comments: media.comment_count || 0,
                views: media.view_count || media.play_count || 0,
                plays: media.play_count || 0,
            },
            comments: isStory ? [] : this.parseComments(comments),
            media: [],
        };

        if (media.carousel_media?.length) {
            for (const item of media.carousel_media) {
                result.media.push(this.#mapMediaItem(item));
            }
        } else {
            result.media.push(this.#mapMediaItem(media));
        }

        return result;
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

        const media = await this.fetchMediaInfo(shortcode);
        if (!media) {
            throw new Error(
                "Failed to fetch. Post may be private or session expired.",
            );
        }

        const result = this.parse(media);
        if (!result.media.length) {
            throw new Error("No downloadable media found.");
        }

        return result;
    }

    /**
     * Resolve a username to its profile info + numeric user id.
     * Tries web_profile_info (rich data); falls back to topsearch on
     * rate-limit (id + basic fields only, no follower/bio counts).
     * @param {string} username
     * @returns {Promise<object>} normalized user object
     */
    async resolveUser(username) {
        const user = username.trim().replace(/^@/, "").toLowerCase();
        const { cookies, csrf } = this.getSession();
        const headers = {
            "User-Agent": this.#ua,
            "X-IG-App-ID": "936619743392459",
            "X-ASBD-ID": "129477",
            "X-CSRFToken": csrf,
            "X-Requested-With": "XMLHttpRequest",
            Cookie: cookies,
            Referer: `https://www.instagram.com/${user}/`,
        };

        try {
            const { data } = await axios.get(
                `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(user)}`,
                { headers, timeout: 15_000 },
            );
            const u = data?.data?.user;
            if (u) {
                return {
                    id: u.id,
                    username: u.username,
                    fullName: u.full_name || "",
                    avatar: u.profile_pic_url_hd || u.profile_pic_url || "",
                    bio: u.biography || "",
                    isPrivate: !!u.is_private,
                    isVerified: !!u.is_verified,
                    posts: u.edge_owner_to_timeline_media?.count || 0,
                    followers: u.edge_followed_by?.count || 0,
                    following: u.edge_follow?.count || 0,
                };
            }
        } catch (e) {
            if (e.response?.status !== 429) {
                throw e;
            }
        }

        const { data } = await axios.get(
            `https://www.instagram.com/api/v1/web/search/topsearch/?query=${encodeURIComponent(user)}&context=blended`,
            {
                headers: { ...headers, Referer: "https://www.instagram.com/" },
                timeout: 15_000,
            },
        );
        const hit =
            data?.users?.find((x) => x.user?.username === user)?.user ||
            data?.users?.[0]?.user;
        if (!hit) {
            throw new Error("User not found or session expired.");
        }
        return {
            id: String(hit.pk),
            username: hit.username,
            fullName: hit.full_name || "",
            avatar: hit.profile_pic_url || "",
            bio: "",
            isPrivate: !!hit.is_private,
            isVerified: !!hit.is_verified,
            posts: 0,
            followers: 0,
            following: 0,
        };
    }

    /**
     * Fetch a full profile: info, posts, active stories, highlights.
     * Stories/highlights require the session to follow private accounts.
     * @param {string} username
     * @param {number} [postCount=12] - Number of recent posts to fetch
     * @returns {Promise<{user: object, posts: Array, stories: Array, highlights: Array}>}
     */
    async fetchProfile(username, postCount = 12) {
        const user = await this.resolveUser(username);
        const userId = user.id;
        const { cookies, csrf } = this.getSession();
        const headers = {
            "User-Agent": this.#ua,
            "X-IG-App-ID": "936619743392459",
            "X-ASBD-ID": "129477",
            "X-CSRFToken": csrf,
            "X-Requested-With": "XMLHttpRequest",
            Cookie: cookies,
            Referer: `https://www.instagram.com/${user.username}/`,
        };

        const get = async (url) => {
            try {
                const { data } = await axios.get(url, {
                    headers,
                    timeout: 15_000,
                });
                return data;
            } catch {
                return null;
            }
        };

        const [feed, storyData, tray] = await Promise.all([
            get(
                `https://www.instagram.com/api/v1/feed/user/${userId}/?count=${postCount}`,
            ),
            get(
                `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`,
            ),
            get(
                `https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`,
            ),
        ]);

        const posts = (feed?.items || []).map((item) => ({
            shortcode: item.code || "",
            caption: item.caption?.text || "",
            likes: item.like_count || 0,
            comments: item.comment_count || 0,
            isVideo: item.media_type === 2 || !!item.video_versions?.length,
            thumbnail: this.#imageUrl(item),
        }));

        const storyItems = storyData?.reels?.[userId]?.items || [];
        const stories = storyItems.map((item) => this.#mapMediaItem(item));

        const highlights = (tray?.tray || []).map((h) => ({
            id: String(h.id).replace(/^highlight:/, ""),
            title: h.title || "",
            cover: h.cover_media?.cropped_image_version?.url || "",
        }));

        return { user, posts, stories, highlights };
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
