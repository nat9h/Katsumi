/**
 * @fileoverview ToVideo command — converts an animated sticker to MP4 video.
 * @module commands/converter/tovideo
 */

import { CommandBuilder } from "#structures/CommandBuilder";
import { stickerToVideo } from "#utils/converter/media";
import { fetchMedia } from "#utils/message";

export default new CommandBuilder()
    .setName("tovideo")
    .setAliases("tomp4", "tv")
    .setDescription("Convert an animated sticker to MP4 video")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}tovideo")
    .setReact("🎬")
    .setRateLimit(8000, 3)
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 8 * 1024 * 1024,
        });

        if (!media || media.type !== "sticker") {
            return interaction.reply("Send or reply to an animated sticker.");
        }

        const video = await stickerToVideo(media.buffer);
        await interaction.reply({ video, mimetype: "video/mp4" });
    });
