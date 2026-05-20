/**
 * @fileoverview Album command — collect multiple images/videos and send as an album.
 * Uses baileys native album support: album header + albumParentKey on each media.
 * @module commands/converter/album
 */

import { downloadMediaMessage } from "baileys";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { detectMedia, extractText } from "#libs/utils/message";

const MAX_ITEMS = 10;

export default new CommandBuilder()
    .setName("album")
    .setDescription("Collect images/videos and send as an album")
    .setUsage("{prefix}{name} [caption]")
    .setExample("{prefix}album vacation photos")
    .setNote(
        "Send images/videos after the command. Type 'done' or 'kirim' to send.",
    )
    .setRateLimit(30_000, 2)
    .setHandler(async (interaction) => {
        const caption = interaction.body || "";
        const media = [];

        if (interaction.quoted) {
            const detected = detectMedia(interaction.quoted.message);
            if (detected.type === "image" || detected.type === "video") {
                const key = {
                    remoteJid: interaction.chatJid,
                    id: interaction.quoted.stanzaId,
                    fromMe: false,
                };
                if (interaction.quoted.sender) {
                    key.participant = interaction.quoted.sender;
                }
                try {
                    const buffer = await downloadMediaMessage(
                        { key, message: interaction.quoted.message },
                        "buffer",
                        {},
                    );
                    media.push({ buffer, type: detected.type });
                } catch {}
            }
        }

        await interaction.reply(
            `📸 *Album mode* — send up to ${MAX_ITEMS} images/videos.\n` +
                `Type *done* or *kirim* when finished.\n` +
                `_Timeout: 60s | Collected: ${media.length}/${MAX_ITEMS}_`,
        );

        const collector = interaction.createMessageCollector({
            filter: () => true,
            time: 60_000,
            max: MAX_ITEMS + 5,
        });

        await new Promise((resolve) => {
            collector.on("collect", async (msg) => {
                const text = extractText(msg.message)?.toLowerCase().trim();
                if (text === "done" || text === "kirim" || text === "send") {
                    collector.stop("done");
                    return;
                }

                const detected = detectMedia(msg.message);
                if (
                    (detected.type === "image" || detected.type === "video") &&
                    media.length < MAX_ITEMS
                ) {
                    try {
                        const buffer = await downloadMediaMessage(
                            msg,
                            "buffer",
                            {},
                        );
                        media.push({ buffer, type: detected.type });
                        if (media.length >= MAX_ITEMS) {
                            collector.stop("max");
                        }
                    } catch {}
                }
            });

            collector.on("end", () => resolve());
        });

        if (media.length < 2) {
            return interaction.followUp(
                "Need at least 2 images/videos for an album.",
            );
        }

        await interaction.followUp(`Sending album (${media.length} items)...`);

        const imageCount = media.filter((m) => m.type === "image").length;
        const videoCount = media.filter((m) => m.type === "video").length;

        const sendOpts = { messageId: interaction.client.generateMsgId() };
        if (interaction.autoEphemeral && interaction.expiration > 0) {
            sendOpts.ephemeralExpiration = interaction.expiration;
        }

        const albumMsg = await interaction.sock.sendMessage(
            interaction.chatJid,
            {
                album: {
                    expectedImageCount: imageCount,
                    expectedVideoCount: videoCount,
                },
            },
            sendOpts,
        );

        for (let i = 0; i < media.length; i++) {
            const item = media[i];
            const content =
                item.type === "image"
                    ? { image: item.buffer }
                    : { video: item.buffer };

            if (i === 0 && caption) {
                content.caption = caption;
            }

            const itemOpts = { messageId: interaction.client.generateMsgId() };
            if (interaction.autoEphemeral && interaction.expiration > 0) {
                itemOpts.ephemeralExpiration = interaction.expiration;
            }

            await interaction.sock.sendMessage(
                interaction.chatJid,
                { ...content, albumParentKey: albumMsg.key },
                itemOpts,
            );
        }
    });
