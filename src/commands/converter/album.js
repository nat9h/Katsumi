/**
 * @fileoverview Album command — collect multiple images/videos and send as an album.
 * Uses Interaction.sendAlbum which wraps the native AlbumMessage + albumParentKey
 * mechanism so all media are grouped into a single album bubble.
 * @module commands/converter/album
 */

import { downloadMediaMessage } from "baileys";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { detectMedia, extractText } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("album")
    .setDescription("Collect images/videos and send as an album")
    .setUsage("{prefix}{name} [caption]")
    .setExample("{prefix}{name} vacation photos")
    .setReact("📸")
    .setRateLimit(30_000, 2)
    .setHandler(async (interaction) => {
        const MAX_ITEMS = 10;
        const MIN_ITEMS = 2;
        const TIMEOUT = 60_000;
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
                `Type *done* / *kirim* / *send* to finish, *cancel* to abort.\n` +
                `_Timeout: ${Math.floor(TIMEOUT / 1000)}s | Collected: ${media.length}/${MAX_ITEMS}_`,
        );

        const collector = interaction.createMessageCollector({
            filter: () => true,
            time: TIMEOUT,
            max: MAX_ITEMS + 5,
        });

        let cancelled = false;

        await new Promise((resolve) => {
            collector.on("collect", async (msg) => {
                const text = extractText(msg.message)?.toLowerCase().trim();
                if (text === "cancel" || text === "batal") {
                    cancelled = true;
                    collector.stop("cancel");
                    return;
                }
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

        if (cancelled) {
            return interaction.followUp("Album cancelled.");
        }

        if (media.length < MIN_ITEMS) {
            return interaction.followUp(
                `Need at least ${MIN_ITEMS} images/videos for an album.`,
            );
        }

        await interaction.followUp(`Sending album (${media.length} items)…`);
        await interaction.sendAlbum(media, { caption });
    });
