/**
 * @fileoverview StickerPack command — collect multiple images/videos/stickers
 * and send them as a NATIVE StickerPackMessage (real "Lihat paket stiker" bubble).
 * Supports 1–20 stickers. User sends media then types "done" to finish.
 * @module commands/converter/stickerpack
 */

import { downloadMediaMessage } from "baileys";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { detectMedia, extractText } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("stickerpack")
    .setAliases("spack", "sp")
    .setDescription("Create native sticker pack from multiple media")
    .setUsage("{prefix}{name} [pack name|author name]")
    .setExample("{prefix}{name} MyPack|Natsumi")
    .setReact("📦")
    .setRateLimit(30_000, 2)
    .setHandler(async (interaction) => {
        const MAX_ITEMS = 20;
        const COLLECT_TIMEOUT = 90_000;
        const { positional } = interaction.parseFlags({});
        const text = positional.join(" ");

        let pack = "@natsumiworld";
        let author = interaction.userName || "";
        if (text.includes("|")) {
            const parts = text.split("|").map((s) => s.trim());
            pack = parts[0] || pack;
            author = parts[1] || author;
        } else if (text) {
            pack = text;
        }

        const buffers = [];

        if (interaction.quoted) {
            const detected = detectMedia(interaction.quoted.message);
            if (
                detected.type === "image" ||
                detected.type === "video" ||
                detected.type === "sticker"
            ) {
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
                    buffers.push(buffer);
                } catch {}
            }
        }

        await interaction.reply(
            `📦 *Sticker Pack mode*\n` +
                `Pack: *${pack}* | Author: *${author}*\n\n` +
                `Send up to ${MAX_ITEMS} images/videos/stickers.\n` +
                `Type *done* / *kirim* / *send* to finish, *cancel* to abort.\n` +
                `_Timeout: ${Math.floor(COLLECT_TIMEOUT / 1000)}s | Collected: ${buffers.length}/${MAX_ITEMS}_`,
        );

        const collector = interaction.createMessageCollector({
            filter: () => true,
            time: COLLECT_TIMEOUT,
            max: MAX_ITEMS + 10,
        });

        let cancelled = false;

        await new Promise((resolve) => {
            collector.on("collect", async (msg) => {
                const msgText = extractText(msg.message)?.toLowerCase().trim();
                if (msgText === "cancel" || msgText === "batal") {
                    cancelled = true;
                    collector.stop("cancel");
                    return;
                }
                if (
                    msgText === "done" ||
                    msgText === "kirim" ||
                    msgText === "send"
                ) {
                    collector.stop("done");
                    return;
                }

                const detected = detectMedia(msg.message);
                if (
                    (detected.type === "image" ||
                        detected.type === "video" ||
                        detected.type === "sticker") &&
                    buffers.length < MAX_ITEMS
                ) {
                    try {
                        const buffer = await downloadMediaMessage(
                            msg,
                            "buffer",
                            {},
                        );
                        buffers.push(buffer);
                        if (buffers.length >= MAX_ITEMS) {
                            collector.stop("max");
                        }
                    } catch {}
                }
            });

            collector.on("end", () => resolve());
        });

        if (cancelled) {
            return interaction.followUp("Sticker pack cancelled.");
        }

        if (buffers.length === 0) {
            return interaction.followUp(
                "No media received. Sticker pack aborted.",
            );
        }

        await interaction.followUp(
            `Creating native sticker pack (${buffers.length} item(s))…`,
        );

        try {
            await interaction.createNativeStickerPack(buffers, {
                name: pack,
                publisher: author,
            });
            await interaction.followUp(`Sticker pack sent!`);
        } catch (err) {
            await interaction.followUp(
                `Failed to create sticker pack: ${err.message}`,
            );
        }
    });
