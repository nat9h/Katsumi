/**
 * @fileoverview Group helpers — invite extraction, thumbnail fetch, and
 * native groupInviteMessage builder used by add/invite-related commands.
 * @module libs/utils/group
 */

import { generateWAMessageFromContent, proto, toNumber } from "baileys";
import { fetchProfilePicture } from "#libs/utils/profile";

/**
 * Walk a `groupParticipantsUpdate` 403 response node tree and pull out
 * `{ code, expiration }` for the group invite v4 payload.
 *
 * @param {object|object[]|undefined} content
 * @returns {{ code: string, expiration: string }|null}
 */
export function extractInviteAttrs(content) {
    if (!content) {
        return null;
    }
    const stack = Array.isArray(content) ? [...content] : [content];
    while (stack.length) {
        const node = stack.shift();
        if (!node) {
            continue;
        }
        if (node.attrs?.code && node.attrs?.expiration) {
            return {
                code: node.attrs.code,
                expiration: node.attrs.expiration,
            };
        }
        if (Array.isArray(node.content)) {
            stack.push(...node.content);
        }
    }
    return null;
}

/**
 * Fetch a group's preview thumbnail as a JPEG buffer for invite messages.
 * Returns null silently on any failure.
 *
 * @param {import('baileys').WASocket} sock
 * @param {string} groupJid
 * @returns {Promise<Buffer|null>}
 */
export async function fetchGroupThumbnail(sock, groupJid) {
    try {
        const url = await fetchProfilePicture(sock, groupJid, "preview");
        if (!url) {
            return null;
        }
        const res = await fetch(url);
        if (!res.ok) {
            return null;
        }
        return Buffer.from(await res.arrayBuffer());
    } catch {
        return null;
    }
}

/**
 * Build a native WhatsApp groupInviteMessage ready to be sent via
 * `sock.sendMessage(jid, { forward: msg })`.
 *
 * @param {object} args
 * @param {import('baileys').WASocket} args.sock
 * @param {string} args.groupJid
 * @param {string} args.targetJid
 * @param {string} args.code
 * @param {string|number} args.expiration
 * @param {string} args.groupName
 * @param {Buffer|null} [args.thumbnail]
 * @returns {Promise<import('baileys').proto.IWebMessageInfo>}
 */
export async function buildGroupInviteMessage({
    sock,
    groupJid,
    targetJid,
    code,
    expiration,
    groupName,
    thumbnail = null,
}) {
    return generateWAMessageFromContent(
        targetJid,
        proto.Message.fromObject({
            groupInviteMessage: {
                groupJid,
                inviteCode: code,
                inviteExpiration: toNumber(expiration),
                groupName,
                jpegThumbnail: thumbnail || null,
                caption: `Invitation to join *${groupName}*`,
            },
        }),
        { userJid: sock.user?.id },
    );
}
