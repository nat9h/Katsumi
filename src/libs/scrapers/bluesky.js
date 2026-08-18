/**
 * @fileoverview Bluesky downloader via public AppView API (no auth needed).
 * @module scrapers/bluesky
 */

import axios from "axios";

class Bluesky {
    #api = "https://public.api.bsky.app/xrpc";

    /**
     * Parse a bsky.app post URL into { handle, rkey }.
     * @param {string} url
     * @returns {{handle: string, rkey: string}|null}
     */
    parseUrl(url) {
        const m = url
            .trim()
            .match(/bsky\.app\/profile\/([^/]+)\/post\/([a-z0-9]+)/i);
        return m ? { handle: m[1], rkey: m[2] } : null;
    }

    /**
     * Resolve a handle (or pass through a DID) to a DID.
     * @param {string} handle
     * @returns {Promise<string>}
     */
    async resolveDid(handle) {
        if (handle.startsWith("did:")) {
            return handle;
        }
        const { data } = await axios.get(
            `${this.#api}/com.atproto.identity.resolveHandle`,
            { params: { handle }, timeout: 15_000 },
        );
        return data.did;
    }

    /**
     * Resolve the PDS endpoint that hosts a DID's blobs.
     * @param {string} did
     * @returns {Promise<string>}
     */
    async resolvePds(did) {
        const url = did.startsWith("did:web:")
            ? `https://${decodeURIComponent(did.slice(8))}/.well-known/did.json`
            : `https://plc.directory/${did}`;
        const { data } = await axios.get(url, { timeout: 15_000 });
        const svc = data.service?.find((s) =>
            s.type?.includes("PersonalDataServer"),
        );
        return svc?.serviceEndpoint || "https://bsky.social";
    }

    /**
     * Collect media from a post's embed view.
     * @param {object} embed - post.embed (view form)
     * @param {string} did
     * @param {string} pds
     * @param {object} record - post.record (for video blob cid)
     * @returns {Array<{type: string, url: string}>}
     */
    #parseMedia(embed, did, pds, record) {
        if (!embed) {
            return [];
        }
        const type = embed.$type || "";

        if (type.startsWith("app.bsky.embed.recordWithMedia")) {
            return this.#parseMedia(embed.media, did, pds, record);
        }

        if (type.startsWith("app.bsky.embed.images")) {
            return (embed.images || []).map((i) => ({
                type: "image",
                url: i.fullsize,
            }));
        }

        if (type.startsWith("app.bsky.embed.video")) {
            const cid = record?.embed?.video?.ref?.$link || embed.cid;
            return [
                {
                    type: "video",
                    url: `${pds}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`,
                },
            ];
        }

        if (type.startsWith("app.bsky.embed.external")) {
            const ext = embed.external;
            if (/\.(gif|mp4)$/i.test(ext?.uri || "")) {
                return [{ type: "video", url: ext.uri }];
            }
            return ext?.thumb ? [{ type: "image", url: ext.thumb }] : [];
        }

        return [];
    }

    /**
     * Download a Bluesky post's media.
     * @param {string} url - bsky.app post URL
     * @returns {Promise<{text: string, author: string, handle: string, stats: object, media: Array}>}
     */
    async download(url) {
        const parsed = this.parseUrl(url || "");
        if (!parsed) {
            throw new Error(
                "Invalid Bluesky URL. Expected: https://bsky.app/profile/<handle>/post/<id>",
            );
        }

        const did = await this.resolveDid(parsed.handle);
        const { data } = await axios.get(
            `${this.#api}/app.bsky.feed.getPostThread`,
            {
                params: {
                    uri: `at://${did}/app.bsky.feed.post/${parsed.rkey}`,
                    depth: 0,
                    parentHeight: 0,
                },
                timeout: 15_000,
            },
        );

        const post = data?.thread?.post;
        if (!post) {
            throw new Error("Post not found or is private.");
        }

        const pds = await this.resolvePds(did);
        const media = this.#parseMedia(post.embed, did, pds, post.record);
        if (!media.length) {
            throw new Error("No downloadable media found in this post.");
        }

        return {
            text: post.record?.text || "",
            author: post.author?.displayName || post.author?.handle || "",
            handle: post.author?.handle || "",
            stats: {
                likes: post.likeCount || 0,
                reposts: post.repostCount || 0,
                replies: post.replyCount || 0,
            },
            media,
        };
    }
}

export default new Bluesky();
