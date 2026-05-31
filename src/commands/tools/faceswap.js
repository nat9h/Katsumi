/**
 * @fileoverview Face swap command — swap faces between two images.
 * @module commands/tools/faceswap
 */

import { downloadMediaMessage } from "baileys";
import { FaceSwap } from "#libs/scrapers/faceswap";
import { uguu } from "#libs/storage/uploader";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { detectMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("faceswap")
    .setAliases("swap")
    .setDescription("Swap faces between two images")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}{name}")
    .setNote(
        "Send/reply to the target image, then bot will ask for the face image.",
    )
    .setReact("🎭")
    .setRateLimit(30_000, 2)
    .setHandler(async (interaction) => {
        const { msg, quoted, chatJid } = interaction;

        let targetBuffer;
        const targetMedia = detectMedia(msg.message);

        if (targetMedia.type === "image") {
            targetBuffer = await downloadMediaMessage(msg, "buffer", {});
        } else if (quoted) {
            const quotedMedia = detectMedia(quoted.message);
            if (quotedMedia.type === "image") {
                const key = {
                    remoteJid: chatJid,
                    id: quoted.stanzaId,
                    fromMe: false,
                };
                if (quoted.sender) {
                    key.participant = quoted.sender;
                }
                targetBuffer = await downloadMediaMessage(
                    { key, message: quoted.message },
                    "buffer",
                    {},
                );
            }
        }

        if (!targetBuffer) {
            return interaction.reply(
                "Send or reply to the *target image* (body to put the face on).",
            );
        }

        await interaction.reply(
            "Now send the *face image* (the face you want to swap in).",
        );

        const reply = await interaction
            .awaitReply((m) => {
                const media = detectMedia(m.message);
                return media.type === "image";
            }, 60_000)
            .catch(() => null);

        if (!reply) {
            return interaction.reply("No face image received. Cancelled.");
        }

        const faceBuffer = await downloadMediaMessage(reply, "buffer", {});
        if (!faceBuffer?.length) {
            return interaction.reply("Failed to download face image.");
        }

        await interaction.reply("Swapping faces...");

        const [sourceUrl, faceUrl] = await Promise.all([
            uguu(targetBuffer),
            uguu(faceBuffer),
        ]);

        const swapper = new FaceSwap();
        const resultUrl = await swapper.run(sourceUrl, faceUrl);
        return interaction.reply({ image: { url: resultUrl } });
    });
