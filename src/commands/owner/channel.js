/**
 * @fileoverview Channel management command.
 * @module commands/owner/channel
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import {
    buildPostContent,
    channelLabel,
    confirmChannelAction,
    formatChannelInfo,
    formatChannelPosts,
    normalizeNewsletterPosts,
    parsePostCount,
    resolveChannel,
    subcommands,
} from "#libs/utils/channel";
import { fetchMedia, resolveUserTarget } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("channel")
    .setAliases("newsletter")
    .setDescription("Manage WhatsApp Channels")
    .setUsage("{prefix}{name} <subcommand> [args]")
    .setNote(`subcommands: ${subcommands.join(", ")}`)
    .setGuard("owner")
    .setReact("📢")
    .setHandler(async (interaction) => {
        const { sock, rawArgs } = interaction;
        const sub = rawArgs[0]?.toLowerCase();

        if (!sub || sub === "help") {
            const list = subcommands.map((s) => `• ${s}`).join("\n");
            return interaction.reply(
                `*Channel Subcommands:*\n${list}\n\n` +
                    `${interaction.usage()}\n` +
                    `Details: \`${interaction.prefix}menu ${interaction.commandName}\``,
            );
        }

        if (sub === "create") {
            const [name, ...description] = rawArgs
                .slice(1)
                .join(" ")
                .split("|");
            if (!name?.trim()) {
                return interaction.reply(
                    `Usage: ${interaction.prefix}${interaction.commandName} create <name> | [description]`,
                );
            }

            const metadata = await sock.newsletterCreate(
                name.trim(),
                description.join("|").trim() || undefined,
            );
            return interaction.reply(
                `✅ Created *${metadata.name || name.trim()}*\nJID: \`${metadata.id}\``,
            );
        }

        const channel = await resolveChannel(sock, rawArgs[1]);

        switch (sub) {
            case "info":
                return interaction.reply(formatChannelInfo(channel));

            case "stats": {
                const [subscriberResult, admins] = await Promise.all([
                    sock.newsletterSubscribers(channel.jid),
                    sock.newsletterAdminCount(channel.jid),
                ]);
                return interaction.reply(
                    formatChannelInfo(
                        channel,
                        subscriberResult?.subscribers,
                        admins,
                    ),
                );
            }

            case "posts": {
                const count = parsePostCount(rawArgs[2]);
                if (count === null) {
                    return interaction.reply(
                        "Count must be an integer from 1 to 100.",
                    );
                }
                const result = await sock.newsletterFetchMessages(
                    channel.jid,
                    count,
                    0,
                    0,
                );
                const posts = normalizeNewsletterPosts(result).slice(0, count);
                return interaction.reply(
                    `📢 *Posts — ${channel.metadata?.name || channel.jid}*\n\n${formatChannelPosts(posts)}`,
                );
            }

            case "follow":
                await sock.newsletterFollow(channel.jid);
                return interaction.reply(`Followed ${channelLabel(channel)}.`);

            case "unfollow":
                await sock.newsletterUnfollow(channel.jid);
                return interaction.reply(
                    `Unfollowed ${channelLabel(channel)}.`,
                );

            case "mute":
                await sock.newsletterMute(channel.jid);
                return interaction.reply(`Muted ${channelLabel(channel)}.`);

            case "unmute":
                await sock.newsletterUnmute(channel.jid);
                return interaction.reply(`Unmuted ${channelLabel(channel)}.`);

            case "subscribe": {
                const result = await sock.subscribeNewsletterUpdates(
                    channel.jid,
                );
                const duration = result?.duration
                    ? ` (${result.duration})`
                    : "";
                return interaction.reply(
                    `Subscribed to updates for ${channelLabel(channel)}${duration}.`,
                );
            }

            case "react":
            case "unreact": {
                const serverId = rawArgs[2];
                const emoji = rawArgs[3];
                if (!serverId || (sub === "react" && !emoji)) {
                    return interaction.reply(
                        `Usage: ${interaction.prefix}${interaction.commandName} ${sub} <link|jid> <serverId>${sub === "react" ? " <emoji>" : ""}`,
                    );
                }
                await sock.newsletterReactMessage(
                    channel.jid,
                    serverId,
                    sub === "react" ? emoji : undefined,
                );
                return interaction.reply(
                    `✅ Reaction ${sub === "react" ? "sent" : "removed"}.`,
                );
            }

            case "post": {
                const text = rawArgs.slice(2).join(" ").trim();
                const media = await fetchMedia(interaction, {
                    maxBytes: 30 * 1024 * 1024,
                });
                const content = buildPostContent(media, text);

                if (!content) {
                    return interaction.reply(
                        media
                            ? "Only image, video, or document posts are supported."
                            : "Provide text or send/reply to media.",
                    );
                }

                const sent = await sock.sendMessage(channel.jid, content);
                return interaction.reply(
                    `✅ Posted to ${channelLabel(channel)}${sent?.key?.id ? `\nMessage: \`${sent.key.id}\`` : ""}`,
                );
            }

            case "rename":
            case "description": {
                const value = rawArgs.slice(2).join(" ").trim();
                if (!value) {
                    return interaction.reply(
                        `Usage: ${interaction.prefix}${interaction.commandName} ${sub} <link|jid> <text>`,
                    );
                }
                if (sub === "rename") {
                    await sock.newsletterUpdateName(channel.jid, value);
                } else {
                    await sock.newsletterUpdateDescription(channel.jid, value);
                }
                return interaction.reply(
                    `${sub} updated for ${channelLabel(channel)}.`,
                );
            }

            case "setpicture": {
                const media = await fetchMedia(interaction, {
                    maxBytes: 16 * 1024 * 1024,
                });
                if (media?.type !== "image") {
                    return interaction.reply("Send or reply to an image.");
                }
                await sock.newsletterUpdatePicture(channel.jid, media.buffer);
                return interaction.reply(
                    `Picture updated for ${channelLabel(channel)}.`,
                );
            }

            case "removepicture":
                await sock.newsletterRemovePicture(channel.jid);
                return interaction.reply(
                    `Picture removed from ${channelLabel(channel)}.`,
                );

            case "transfer":
            case "demote": {
                const user = resolveUserTarget(
                    interaction,
                    rawArgs.slice(2).join(" "),
                );
                if (!user?.endsWith("@s.whatsapp.net")) {
                    return interaction.reply(
                        "Mention a user or provide a valid phone number.",
                    );
                }
                if (
                    !(await confirmChannelAction(
                        interaction,
                        sub,
                        channel,
                        user,
                    ))
                ) {
                    return;
                }

                if (sub === "transfer") {
                    await sock.newsletterChangeOwner(channel.jid, user);
                } else {
                    await sock.newsletterDemote(channel.jid, user);
                }
                return interaction.followUp(
                    `${sub} completed for ${channelLabel(channel)}.`,
                );
            }

            case "delete":
                if (!(await confirmChannelAction(interaction, sub, channel))) {
                    return;
                }
                await sock.newsletterDelete(channel.jid);
                return interaction.followUp(
                    `Deleted ${channelLabel(channel)}.`,
                );

            default:
                return interaction.reply(
                    `Unknown: *${sub}*\nUse \`${interaction.prefix}menu ${interaction.commandName}\` to see available subcommands.`,
                );
        }
    });
