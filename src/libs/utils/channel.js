import { extractText, findContextInfo } from "#libs/utils/message";

export const subcommands = [
    "create",
    "info",
    "posts",
    "stats",
    "follow",
    "unfollow",
    "mute",
    "unmute",
    "subscribe",
    "post",
    "react",
    "unreact",
    "rename",
    "description",
    "setpicture",
    "removepicture",
    "transfer",
    "demote",
    "delete",
];

const channelJidPattern = /^\d+@newsletter$/;
const channelUrlPattern =
    /^(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([\w-]+)\/?(?:\?\S*)?$/i;
const confirmationTimeout = 30_000;

export function parseChannelTarget(input) {
    const value = input?.trim();
    if (!value) {
        return null;
    }
    if (channelJidPattern.test(value)) {
        return { type: "jid", key: value };
    }

    const match = value.match(channelUrlPattern);
    return match ? { type: "invite", key: match[1] } : null;
}

export function parsePostCount(input, fallback = 10) {
    if (input === undefined) {
        return fallback;
    }
    if (!/^\d+$/.test(input)) {
        return null;
    }

    const count = Number(input);
    return count >= 1 && count <= 100 ? count : null;
}

export function normalizeNewsletterPosts(result) {
    if (Array.isArray(result)) {
        return result;
    }

    const candidates = [
        result?.messages,
        result?.result?.messages,
        result?.data?.messages,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }
    return [];
}

export function matchesConfirmation(text, operation, jid) {
    return text?.trim().toLowerCase() === `confirm ${operation} ${jid}`;
}

export async function resolveChannel(sock, input) {
    const target = parseChannelTarget(input);
    if (!target) {
        throw new Error(
            "Use a valid whatsapp.com/channel link or @newsletter JID.",
        );
    }

    const metadata = await sock.newsletterMetadata(target.type, target.key);
    const jid = metadata?.id || (target.type === "jid" ? target.key : null);
    if (!channelJidPattern.test(jid || "")) {
        throw new Error("Channel not found or unavailable.");
    }

    return { jid, metadata: metadata || { id: jid, name: jid } };
}

export function channelLabel(channel) {
    return `${channel.metadata?.name || "Channel"} (${channel.jid})`;
}

export function formatChannelInfo(channel, subscribers, admins) {
    const metadata = channel.metadata || {};
    const lines = [
        `📢 *${metadata.name || "Channel"}*`,
        `• JID: \`${channel.jid}\``,
    ];

    if (metadata.description) {
        lines.push(`• Description: ${metadata.description}`);
    }
    if (metadata.invite) {
        lines.push(`• Invite: https://whatsapp.com/channel/${metadata.invite}`);
    }
    if (metadata.owner) {
        lines.push(`• Owner: ${metadata.owner}`);
    }

    const subscriberCount = subscribers ?? metadata.subscribers;
    if (subscriberCount !== undefined) {
        lines.push(`• Subscribers: ${subscriberCount}`);
    }
    if (admins !== undefined) {
        lines.push(`• Admins: ${admins}`);
    }
    if (metadata.verification) {
        lines.push(`• Verification: ${metadata.verification}`);
    }
    if (metadata.mute_state) {
        lines.push(`• Muted: ${metadata.mute_state === "ON" ? "yes" : "no"}`);
    }

    return lines.join("\n");
}

const MEDIA_LABEL = {
    imageMessage: "image",
    videoMessage: "video",
    documentMessage: "document",
};

export function formatChannelPosts(posts) {
    if (!posts.length) {
        return "No channel posts found.";
    }

    return posts
        .map((post, index) => {
            const id =
                post?.server_id ||
                post?.serverId ||
                post?.key?.id ||
                post?.id ||
                "?";
            const message =
                post?.message || post?.msg?.message || post?.content || {};

            let media;
            for (const [key, label] of Object.entries(MEDIA_LABEL)) {
                if (message[key]) {
                    media = label;
                    break;
                }
            }

            const text = (
                message.conversation ||
                message.extendedTextMessage?.text ||
                message.imageMessage?.caption ||
                message.videoMessage?.caption ||
                post?.text ||
                ""
            )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 180);

            return `${index + 1}. \`${id}\`${media ? ` [${media}]` : ""}${text ? `\n   ${text}` : ""}`;
        })
        .join("\n");
}

export function buildPostContent(media, text) {
    if (!media) {
        return text ? { text } : null;
    }

    switch (media.type) {
        case "image":
            return { image: media.buffer, caption: text };
        case "video":
            return { video: media.buffer, caption: text };
        case "document":
            return {
                document: media.buffer,
                mimetype: "application/octet-stream",
                fileName: "channel-file",
                caption: text,
            };
        default:
            return null;
    }
}

export async function confirmChannelAction(
    interaction,
    operation,
    channel,
    user,
) {
    const token = `confirm ${operation} ${channel.jid}`;
    const mentionLine = user ? `\nUser: @${user.split("@")[0]}` : "";
    const text = `⚠️ *Confirm ${operation}*\nChannel: *${channel.metadata?.name || "Channel"}*\nJID: \`${channel.jid}\`${mentionLine}\n\nReply within 30 seconds with:\n\`${token}\``;

    const prompt = await interaction.reply(
        user ? { text, mentions: [user] } : text,
    );
    const promptId = prompt?.key?.id;

    try {
        const reply = await interaction.awaitReply((msg) => {
            const context = findContextInfo(msg.message);
            return (
                Boolean(promptId) &&
                context?.stanzaId === promptId &&
                matchesConfirmation(
                    extractText(msg.message),
                    operation,
                    channel.jid,
                )
            );
        }, confirmationTimeout);

        return matchesConfirmation(
            extractText(reply.message),
            operation,
            channel.jid,
        );
    } catch {
        await interaction.followUp(
            "Cancelled: confirmation timed out or did not match.",
        );
        return false;
    }
}
