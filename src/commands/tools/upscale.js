/**
 * @fileoverview Upscale command — enhance image/video resolution using AI.
 * Images: imgupscaler.com (2x/4x) or wink.ai (Ultra HD with --wink)
 * Videos: wink.ai (Ultra HD)
 * @module commands/tools/upscale
 */

import { Upscaler } from "#libs/scrapers/upscale";
import { WinkUpscaler } from "#libs/scrapers/wink";
import { uguu } from "#libs/storage/uploader";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("upscale")
    .setAliases("hd", "enhance")
    .setDescription("Upscale image (2x/4x) or enhance video to Ultra HD")
    .setUsage("{prefix}{name} [--4x] [--wink/-w]")
    .setExample("{prefix}upscale\n{prefix}upscale -w")
    .setNote(
        "Send or reply to an image/video. Use --4x for 4x image upscale, --wink/-w for wink HD enhancer on images.",
    )
    .setReact("🔍")
    .setRateLimit(15_000, 2)
    .setHandler(async (interaction) => {
        const { flags } = interaction.parseFlags({
            "4x": { type: "boolean" },
            wink: { type: "boolean", alias: "w" },
        });

        const media = await fetchMedia(interaction, {
            maxBytes: 50 * 1024 * 1024,
        });

        const isImage = media?.type === "image" || media?.type === "sticker";
        const isVideo = media?.type === "video";

        if (!isImage && !isVideo) {
            return interaction.reply(
                "Send or reply to an image or video to upscale.",
            );
        }

        await interaction.typing();

        if (isVideo) {
            const wink = new WinkUpscaler();
            const { buffer } = await wink.upscaleVideo(media.buffer, {
                filename: media.filename || "video.mp4",
            });
            return interaction.reply({ video: buffer });
        }

        if (flags.wink) {
            const wink = new WinkUpscaler();
            const { buffer } = await wink.upscaleImage(media.buffer, {
                filename: media.filename || "image.jpg",
            });
            return interaction.reply({ image: buffer });
        }

        const scale = flags["4x"] ? 4 : 2;
        const imageUrl = await uguu(media.buffer);
        const upscaler = new Upscaler({ scaleRadio: scale });
        const { buffer } = await upscaler.upscaleFromUrl(imageUrl);
        return interaction.reply({ image: buffer });
    });
