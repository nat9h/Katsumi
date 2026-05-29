/**
 * @fileoverview Story command — all-in-one WhatsApp status/story manager.
 * Subcommands: post, group, get, react.
 * @module commands/owner/story
 */

import { randomBytes } from "node:crypto";
import {
    downloadMediaMessage,
    generateWAMessageContent,
    generateWAMessageFromContent,
} from "baileys";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { detectMedia, extractText, fetchMedia } from "#libs/utils/message";
import {
    getLatestStory,
    getStatusAudience,
    getStatusSenders,
    getStoriesFrom,
} from "#libs/utils/status";

export default new CommandBuilder()
    .setName("story")
    .setAliases("status", "sw", "st")
    .setDescription("All-in-one WhatsApp story/status manager")
    .setUsage("{prefix}{name} <post|group|get|react> [args]")
    .setExample("{prefix}{name} post Hello World!")
    .setNote(
        [
            "Subcommands:",
            "• post [text] — post story (text/media) to all contacts",
            "  Flags: -bg #hex -font 0-5",
            "• group [text] — post story to current group members only",
            "  Flags: -bg #hex -font 0-5",
            "• get [list|@mention|number] — download someone's story",
            "• react <@mention|number> [emoji] — react to latest story",
        ].join("\n"),
    )
    .setGuard("owner")
    .setReact("📤")
    .setRateLimit(5_000, 3)
    .setHandler(async (interaction) => {
        const { sock, client, mentions } = interaction;
        const sub = interaction.rawArgs[0]?.toLowerCase();
        const body = interaction.rawArgs.slice(1).join(" ");

        if (!sub || !["post", "group", "get", "react"].includes(sub)) {
            return interaction.reply(
                [
                    `📖 *Story Manager*\n`,
                    `Usage: ${interaction.prefix}${interaction.commandName} <subcommand>\n`,
                    `• *post* [text] — post story to all contacts`,
                    `• *group* [text] — post story to group members`,
                    `• *get* [list|@user|number] — download story`,
                    `• *react* <@user|number> [emoji] — react to story`,
                    `\nExample: ${interaction.prefix}${interaction.commandName} post Hello!`,
                ].join("\n"),
            );
        }

        const resolveTarget = (text) => {
            if (mentions.length > 0) {
                return mentions[0];
            }
            const digits = (text || "").replace(/[^0-9]/g, "");
            if (digits.length >= 8 && digits.length < 18) {
                return `${digits}@s.whatsapp.net`;
            }
            return null;
        };

        if (sub === "post") {
            const { flags, positional } = interaction.parseFlags({
                bg: { type: "string" },
                font: { type: "string" },
            });
            const text = positional.slice(1).join(" ");
            const statusJidList = await getStatusAudience(client, sock);

            if (!statusJidList.length) {
                return interaction.reply(
                    "No contacts found for status audience.",
                );
            }

            const media = await fetchMedia(interaction, {
                maxBytes: 16 * 1024 * 1024,
            }).catch(() => null);
            if (media) {
                if (!["image", "video", "sticker"].includes(media.type)) {
                    return interaction.reply(
                        "Only image or video can be posted as story.",
                    );
                }
                const content =
                    media.type === "video"
                        ? { video: media.buffer, caption: text }
                        : { image: media.buffer, caption: text };

                await sock.sendMessage("status@broadcast", content, {
                    statusJidList,
                    messageId: client.generateMsgId(),
                });
                return interaction.reply(
                    `✅ Story posted (media) to ${statusJidList.length} contacts.`,
                );
            }

            if (!text) {
                return interaction.reply(
                    "Provide text or reply to an image/video to post as story.",
                );
            }

            await sock.sendMessage(
                "status@broadcast",
                { text },
                {
                    statusJidList,
                    backgroundColor: flags.bg || "#1E90FF",
                    font: parseInt(flags.font, 10) || 0,
                    messageId: client.generateMsgId(),
                },
            );
            return interaction.reply(
                `✅ Story posted (text) to ${statusJidList.length} contacts.`,
            );
        }

        if (sub === "group") {
            const { flags, positional } = interaction.parseFlags({
                bg: { type: "string" },
                font: { type: "string" },
            });
            const text = positional.slice(1).join(" ");

            const media = await fetchMedia(interaction, {
                maxBytes: 16 * 1024 * 1024,
            }).catch(() => null);

            let msgContent;
            let genOpts = {};
            if (media) {
                if (!["image", "video", "sticker"].includes(media.type)) {
                    return interaction.reply(
                        "Only image or video can be posted as story.",
                    );
                }
                msgContent =
                    media.type === "video"
                        ? { video: media.buffer, caption: text }
                        : { image: media.buffer, caption: text };
            } else if (text) {
                msgContent = { text };
                genOpts = {
                    backgroundColor: flags.bg || "#128C7E",
                    font: parseInt(flags.font, 10) || 0,
                };
            } else {
                return interaction.reply(
                    "Provide text or reply to media first.",
                );
            }

            let groups;
            try {
                const all = await sock.groupFetchAllParticipating();
                groups = Object.values(all);
            } catch {
                groups = client.store.getAllGroups?.() || [];
            }

            if (!groups.length) {
                return interaction.reply("No groups found.");
            }

            const lines = groups.map(
                (g, i) =>
                    `${i + 1}. ${g.subject} (${g.participants?.length || "?"} members)`,
            );
            await interaction.reply(
                `📋 *Select target group:*\n\n${lines.join("\n")}\n\n_Reply with number (e.g. 1 or 1,3,5). 60s timeout._`,
            );

            try {
                const reply = await interaction.awaitReply(() => true, 60_000);
                const input = extractText(reply.message).trim();
                const indexes = [
                    ...new Set(
                        input
                            .split(/[,\s]+/)
                            .map((v) => parseInt(v.trim(), 10))
                            .filter((v) => Number.isFinite(v)),
                    ),
                ].filter((i) => i >= 1 && i <= groups.length);

                if (!indexes.length) {
                    return interaction.followUp("Invalid input. Cancelled.");
                }

                const selectedGroups = indexes.map((i) => groups[i - 1]);

                const inside = await generateWAMessageContent(msgContent, {
                    upload: sock.waUploadToServer,
                    ...genOpts,
                });

                const sentNames = [];
                for (const g of selectedGroups) {
                    const messageSecret = randomBytes(32);
                    const msg = generateWAMessageFromContent(
                        g.id,
                        {
                            messageContextInfo: { messageSecret },
                            groupStatusMessageV2: {
                                message: {
                                    ...inside,
                                    messageContextInfo: { messageSecret },
                                },
                            },
                        },
                        { userJid: sock.user.id },
                    );

                    await sock.relayMessage(g.id, msg.message, {
                        messageId: msg.key.id,
                    });
                    sentNames.push(g.subject);
                }

                return interaction.followUp(
                    `✅ Group status sent to:\n${sentNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}`,
                );
            } catch (err) {
                if (err.message === "Timeout") {
                    return interaction.followUp("⏰ Timeout.");
                }
                return interaction.followUp(`❌ Failed: ${err.message}`);
            }
        }

        if (sub === "get") {
            const text = body.trim();

            if (text && text !== "list") {
                const targetJid = resolveTarget(text);
                if (!targetJid) {
                    return interaction.reply(
                        "Mention someone or provide a phone number.",
                    );
                }

                const stories = getStoriesFrom(targetJid);
                if (!stories.length) {
                    return interaction.reply(
                        `No stories from ${targetJid.replace("@s.whatsapp.net", "")}.`,
                    );
                }

                await interaction.reply(
                    `📥 Fetching ${stories.length} story(s) from *${stories[0].pushName}*...`,
                );
                for (const story of stories) {
                    await sendSingleStory(interaction, story);
                }
                return;
            }

            const senders = getStatusSenders();
            if (!senders.length) {
                return interaction.reply(
                    "No stories captured yet. Bot must be online to receive stories.",
                );
            }

            senders.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
            const lines = senders.map((s, i) => {
                const time = new Date(
                    s.lastTimestamp * 1000,
                ).toLocaleTimeString();
                return `${i + 1}. *${s.pushName}* (${s.jid.replace("@s.whatsapp.net", "")}) — ${s.count} story, ${time}`;
            });

            await interaction.reply(
                `📋 *Stories (${senders.length}):*\n\n${lines.join("\n")}\n\n_Reply number to download._`,
            );

            try {
                const reply = await interaction.awaitReply(() => true, 30_000);
                const num = parseInt(extractText(reply.message).trim(), 10);
                if (!Number.isInteger(num) || num < 1 || num > senders.length) {
                    return interaction.followUp("Invalid. Cancelled.");
                }

                const picked = senders[num - 1];
                const stories = getStoriesFrom(picked.jid);
                await interaction.followUp(
                    `📥 Fetching ${stories.length} story(s) from *${picked.pushName}*...`,
                );
                for (const story of stories) {
                    await sendSingleStory(interaction, story);
                }
            } catch {
                return interaction.followUp("⏰ Timeout.");
            }
            return;
        }

        if (sub === "react") {
            if (!body.trim()) {
                return interaction.reply(
                    `Usage: ${interaction.prefix}story react <@user|number> [emoji]`,
                );
            }

            const emojiRe =
                /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu;
            const emojis = body.match(emojiRe);
            const emoji = emojis?.[emojis.length - 1] || "🔥";
            const targetJid = resolveTarget(body.replace(emojiRe, "").trim());

            if (!targetJid) {
                return interaction.reply(
                    "Mention someone or provide a number.",
                );
            }

            const story = getLatestStory(targetJid);
            if (!story) {
                return interaction.reply(
                    `No stories from ${targetJid.replace("@s.whatsapp.net", "")}.`,
                );
            }

            try {
                await sock.sendMessage("status@broadcast", {
                    react: { key: story.key, text: emoji },
                });
                return interaction.reply(
                    `${emoji} Reacted to *${story.pushName}*'s story!`,
                );
            } catch (err) {
                return interaction.reply(`Failed to react: ${err.message}`);
            }
        }
    });

async function sendSingleStory(interaction, story) {
    try {
        const media = detectMedia(story.message);
        const time = new Date(story.timestamp * 1000).toLocaleString();

        if (media.type && media.msg) {
            const buffer = await downloadMediaMessage(
                { key: story.key, message: story.message },
                "buffer",
                {},
            );
            const caption = `📸 *${story.pushName}*\n⏰ ${time}${extractText(story.message) ? `\n\n${extractText(story.message)}` : ""}`;

            if (media.type === "image" || media.type === "sticker") {
                await interaction.followUp({ image: buffer, caption });
            } else if (media.type === "video") {
                await interaction.followUp({ video: buffer, caption });
            } else if (media.type === "audio") {
                await interaction.followUp({
                    audio: buffer,
                    mimetype: "audio/mpeg",
                });
            }
        } else {
            const text = extractText(story.message);
            if (text) {
                await interaction.followUp(
                    `📝 *${story.pushName}*\n⏰ ${time}\n\n${text}`,
                );
            }
        }
    } catch (err) {
        await interaction.followUp(`⚠️ Failed: ${err.message}`);
    }
}
