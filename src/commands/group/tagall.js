/**
 * @fileoverview Hidetag command — silently mention all group members.
 * Supports text, reply to media (image/video/sticker/audio/document).
 * @module commands/group/tagall
 */

import { downloadMediaMessage } from "baileys";
import { CommandBuilder } from "#structures/CommandBuilder";
import { detectMedia } from "#utils/message";

export default new CommandBuilder()
    .setName("tagall")
    .setAliases("everyone", "all", "hidetag", "ht")
    .setDescription("Hidetag — mention all members (supports media)")
    .setUsage("{prefix}{name} [message]")
    .setExample("{prefix}hidetag check this out")
    .setNote("Reply to any media to forward it as hidetag.")
    .setGuard("group", "admin")
    .setRateLimit(60_000, 1)
    .setHandler(async (interaction) => {
        const meta = await interaction.getGroupMeta();
        if (!meta?.participants?.length) {
            return interaction.reply("Could not fetch group participants.");
        }

        const mentions = meta.participants.map((p) => p.id);

        if (interaction.quoted) {
            const detected = detectMedia(interaction.quoted.message);
            if (detected.type) {
                const key = {
                    remoteJid: interaction.chatJid,
                    id: interaction.quoted.stanzaId,
                    fromMe: false,
                };
                if (interaction.quoted.sender) {
                    key.participant = interaction.quoted.sender;
                }

                const buffer = await downloadMediaMessage(
                    { key, message: interaction.quoted.message },
                    "buffer",
                    {},
                );

                const caption =
                    interaction.body || interaction.quoted.text || "";

                let content;
                switch (detected.type) {
                    case "image":
                        content = { image: buffer, caption, mentions };
                        break;
                    case "video":
                        content = { video: buffer, caption, mentions };
                        break;
                    case "sticker":
                        await interaction.sock.sendMessage(
                            interaction.chatJid,
                            { sticker: buffer },
                            {
                                messageId: interaction.client.generateMsgId(),
                            },
                        );
                        if (caption) {
                            return interaction.reply({
                                text: caption,
                                mentions,
                            });
                        }
                        return interaction.reply({
                            text: "\u200E",
                            mentions,
                        });
                    case "audio":
                        content = {
                            audio: buffer,
                            mimetype: "audio/mpeg",
                            mentions,
                        };
                        break;
                    case "document": {
                        const doc = interaction.quoted.message?.documentMessage;
                        content = {
                            document: buffer,
                            mimetype:
                                doc?.mimetype || "application/octet-stream",
                            fileName: doc?.fileName || "file",
                            caption,
                            mentions,
                        };
                        break;
                    }
                    default:
                        content = {
                            text: caption || "\u200E",
                            mentions,
                        };
                }

                return interaction.reply(content);
            }
        }
        const text = interaction.body || "\u200E";
        return interaction.reply({ text, mentions });
    });
