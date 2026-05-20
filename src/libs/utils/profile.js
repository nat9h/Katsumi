import { jidNormalizedUser } from "baileys";

/**
 * Fetch profile picture URL directly via IQ query without tctoken.
 * This avoids the bug where profilePictureUrl fails because the
 * trusted contact token (tctoken) doesn't exist for the target user.
 *
 * @param {import('baileys').WASocket} sock
 * @param {string} jid
 * @param {"image"|"preview"} [type="image"]
 * @returns {Promise<string|null>}
 */
export async function fetchProfilePicture(sock, jid, type = "image") {
    const normalizedJid = jidNormalizedUser(jid);
    const result = await sock.query({
        tag: "iq",
        attrs: {
            target: normalizedJid,
            to: "s.whatsapp.net",
            type: "get",
            xmlns: "w:profile:picture",
        },
        content: [
            {
                tag: "picture",
                attrs: { type, query: "url" },
            },
        ],
    });

    const picture = findChild(result, "picture");
    return picture?.attrs?.url || null;
}

/**
 * Query the full business profile including cover photo.
 * Returns parsed profile info and cover URL if available.
 *
 * @param {import('baileys').WASocket} sock
 * @param {string} jid
 * @returns {Promise<{ profile: object, coverUrl: string|null } | null>}
 */
export async function queryBusinessProfile(sock, jid) {
    const result = await sock.query({
        tag: "iq",
        attrs: {
            to: "s.whatsapp.net",
            xmlns: "w:biz",
            type: "get",
        },
        content: [
            {
                tag: "business_profile",
                attrs: { v: "770" },
                content: [
                    {
                        tag: "profile",
                        attrs: { jid },
                    },
                ],
            },
        ],
    });

    const bizNode = findChild(result, "business_profile");
    const profileNode = findChild(bizNode, "profile");
    if (!profileNode) {
        return null;
    }

    const description = findChild(profileNode, "description");
    const address = findChild(profileNode, "address");
    const email = findChild(profileNode, "email");
    const website = findChild(profileNode, "website");

    const categoriesNode = findChild(profileNode, "categories");
    const categoryNode = findChild(categoriesNode, "category");
    const verticalNode = findChild(profileNode, "vertical");

    const bizIdentity = findChild(profileNode, "biz_identity_info");

    const profile = {
        description: bufToStr(description?.content),
        address: bufToStr(address?.content),
        email: bufToStr(email?.content),
        website: website?.content ? [bufToStr(website.content)] : [],
        category:
            bufToStr(categoryNode?.content) ||
            verticalNode?.attrs?.canonical ||
            "",
        displayName: bizIdentity?.attrs?.display_name || "",
        verificationLevel: bizIdentity?.attrs?.vlevel || "",
    };

    const coverUrl = extractCoverUrl(profileNode);

    return { profile, coverUrl };
}

/**
 * Extract cover photo URL from the business profile node.
 * The cover_photo node content is a Buffer containing the direct_path.
 */
function extractCoverUrl(profileNode) {
    const coverPhoto = findChild(profileNode, "cover_photo");
    if (!coverPhoto) {
        return null;
    }

    const contentStr = bufToStr(coverPhoto.content);
    if (contentStr) {
        if (contentStr.startsWith("http")) {
            return contentStr;
        }
        if (contentStr.startsWith("/")) {
            return `https://mmg.whatsapp.net${contentStr}`;
        }
    }

    if (coverPhoto.attrs?.url) {
        return coverPhoto.attrs.url;
    }
    if (coverPhoto.attrs?.direct_path) {
        return `https://mmg.whatsapp.net${coverPhoto.attrs.direct_path}`;
    }

    return null;
}

/**
 * Convert Buffer/Uint8Array/string to string safely.
 */
function bufToStr(val) {
    if (!val) {
        return "";
    }
    if (typeof val === "string") {
        return val;
    }
    if (Buffer.isBuffer(val)) {
        return val.toString("utf-8");
    }
    if (val instanceof Uint8Array) {
        return Buffer.from(val).toString("utf-8");
    }
    return String(val);
}

/**
 * Find a child node in a binary node structure by tag.
 */
function findChild(node, tag) {
    if (!node?.content || !Array.isArray(node.content)) {
        return null;
    }
    return node.content.find((c) => c?.tag === tag) || null;
}
