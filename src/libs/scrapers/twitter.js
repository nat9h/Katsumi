/**
 * @fileoverview Twitter/X scraper via GraphQL API.
 * @module scrapers/twitter
 */

import axios from "axios";

class Twitter {
    UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    BEARER = process.env.X_BEARER || "";
    EP_TWEET = process.env.X_EP_TWEET || "";
    EP_PROFILE = process.env.X_EP_PROFILE || "";
    FEATURES = {
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        rweb_video_timestamps_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_enhance_cards_enabled: false,
    };

    /**
     * Extract tweet ID from URL.
     * @param {string} url
     * @returns {string|null}
     */
    extractTweetId(url) {
        return (
            url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/)?.[1] ||
            null
        );
    }

    /**
     * Get authenticated headers.
     * @returns {object}
     */
    getHeaders() {
        const authToken = process.env.X_AUTH_TOKEN || "";
        const ct0 = process.env.X_CT0 || "";
        if (!authToken || !ct0) {
            throw new Error("X_AUTH_TOKEN and X_CT0 required in .env.");
        }
        if (!this.BEARER) {
            throw new Error("X_BEARER required in .env.");
        }
        return {
            "User-Agent": this.UA,
            Authorization: `Bearer ${this.BEARER}`,
            "X-Csrf-Token": ct0,
            Cookie: `auth_token=${authToken}; ct0=${ct0};`,
        };
    }

    /**
     * Download tweet by URL.
     * @param {string} url
     * @returns {Promise<object>}
     */
    async download(url) {
        if (!url?.trim()) {
            throw new Error("Twitter/X URL is required.");
        }

        const tweetId = this.extractTweetId(url.trim());
        if (!tweetId) {
            throw new Error("Invalid Twitter/X URL.");
        }

        const variables = {
            focalTweetId: tweetId,
            with_rux_injections: false,
            rankingMode: "Relevance",
            includePromotedContent: false,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: true,
            withBirdwatchNotes: true,
            withVoice: true,
        };

        const { data } = await axios.get(
            `https://x.com/i/api/graphql/${this.EP_TWEET}/TweetDetail`,
            {
                params: {
                    variables: JSON.stringify(variables),
                    features: JSON.stringify(this.FEATURES),
                },
                headers: this.getHeaders(),
                timeout: 15_000,
            },
        );

        const instructions =
            data?.data?.threaded_conversation_with_injections_v2
                ?.instructions || [];
        let result = null;
        for (const inst of instructions) {
            const entries = inst.entries || [];
            for (const entry of entries) {
                if (!entry.entryId?.includes(tweetId)) {
                    continue;
                }
                result = entry.content?.itemContent?.tweet_results?.result;
                if (result) {
                    break;
                }
            }
            if (result) {
                break;
            }
        }

        if (!result) {
            throw new Error("Tweet not found or is private.");
        }

        return this.parseTweet(result);
    }

    /**
     * Parse tweet result into clean structure.
     * @param {object} result
     * @returns {object}
     */
    parseTweet(result) {
        const legacy = result.legacy || result.tweet?.legacy;
        const user =
            result.core?.user_results?.result?.legacy ||
            result.tweet?.core?.user_results?.result?.legacy;

        if (!legacy) {
            throw new Error("Failed to parse tweet data.");
        }

        const parsed = {
            text: legacy.full_text || "",
            author: {
                username: user?.screen_name || "",
                name: user?.name || "",
                avatar:
                    user?.profile_image_url_https?.replace(
                        "_normal",
                        "_400x400",
                    ) || "",
            },
            stats: {
                likes: legacy.favorite_count || 0,
                retweets: legacy.retweet_count || 0,
                replies: legacy.reply_count || 0,
                views: result.views?.count ? Number(result.views.count) : 0,
            },
            media: [],
        };

        const mediaList = legacy.extended_entities?.media || [];
        for (const m of mediaList) {
            if (m.type === "video" || m.type === "animated_gif") {
                const variants =
                    m.video_info?.variants?.filter(
                        (v) => v.content_type === "video/mp4",
                    ) || [];
                const best = variants.sort(
                    (a, b) => (b.bitrate || 0) - (a.bitrate || 0),
                )[0];
                parsed.media.push({
                    type: m.type,
                    url: best?.url || "",
                    thumbnail: m.media_url_https || "",
                    width: m.original_info?.width || 0,
                    height: m.original_info?.height || 0,
                    duration: m.video_info?.duration_millis || 0,
                });
            } else {
                parsed.media.push({
                    type: "photo",
                    url: m.media_url_https || "",
                    thumbnail: m.media_url_https || "",
                    width: m.original_info?.width || 0,
                    height: m.original_info?.height || 0,
                });
            }
        }

        return parsed;
    }

    /**
     * Get user profile info.
     * @param {string} username
     * @returns {Promise<object>}
     */
    async stalk(username) {
        if (!username?.trim()) {
            throw new Error("Username is required.");
        }

        const clean = username.trim().replace(/^@/, "");

        const { data } = await axios.get(
            `https://x.com/i/api/graphql/${this.EP_PROFILE}/UserByScreenName`,
            {
                params: {
                    variables: JSON.stringify({
                        screen_name: clean,
                        withSafetyModeUserFields: true,
                    }),
                    features: JSON.stringify(this.FEATURES),
                    fieldToggles: JSON.stringify({
                        withAuxiliaryUserLabels: false,
                    }),
                },
                headers: this.getHeaders(),
                timeout: 15_000,
            },
        );

        const result = data?.data?.user?.result;
        if (!result) {
            throw new Error(`User @${clean} not found.`);
        }

        const legacy = result.legacy || {};
        const isBlueVerified = result.is_blue_verified ?? false;

        return {
            id: result.rest_id || "",
            username: legacy.screen_name || clean,
            name: legacy.name || "",
            bio: legacy.description || "",
            location: legacy.location || "",
            website:
                legacy.entities?.url?.urls?.[0]?.expanded_url ||
                legacy.url ||
                "",
            avatar:
                legacy.profile_image_url_https?.replace(
                    "_normal",
                    "_400x400",
                ) || "",
            banner: legacy.profile_banner_url || "",
            isVerified: legacy.verified || isBlueVerified,
            isBlueVerified,
            isProtected: legacy.protected ?? false,
            followers: legacy.followers_count || 0,
            following: legacy.friends_count || 0,
            tweets: legacy.statuses_count || 0,
            likes: legacy.favourites_count || 0,
            listed: legacy.listed_count || 0,
            createdAt: legacy.created_at || "",
            pinnedTweet: legacy.pinned_tweet_ids_str?.[0] || null,
        };
    }

    /**
     * Get trending topics.
     * @param {number} [woeid=1] - Where On Earth ID (1=worldwide, 23424846=Indonesia)
     * @returns {Promise<Array<{name: string, url: string, tweetVolume: number|null}>>}
     */
    async trending(woeid = 23424846) {
        const { data } = await axios.get(
            "https://x.com/i/api/1.1/trends/place.json",
            {
                params: { id: woeid },
                headers: this.getHeaders(),
                timeout: 15_000,
            },
        );

        const trends = data?.[0]?.trends || [];
        return trends.map((t) => ({
            name: t.name || "",
            url: t.url || "",
            tweetVolume: t.tweet_volume || null,
        }));
    }
}

export default new Twitter();
