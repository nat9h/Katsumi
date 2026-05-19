/**
 * @fileoverview ToImage command — converts a sticker to PNG image.
 * @module commands/converter/toimage
 */

import { CommandBuilder } from "#structures/CommandBuilder";
import { stickerToImage } from "#utils/converter/media";
import { fetchMedia } from "#utils/message";

export default new CommandBuilder()
    .setName("toimage")
    .setAliases("toimg", "ti")
    .setDescription("Convert a sticker to image (PNG)")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}toimage")
    .setReact("🖼️")
    .setRateLimit(5000, 3)
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 5 * 1024 * 1024,
        });

        if (!media || media.type !== "sticker") {
            return interaction.reply("Send or reply to a sticker.");
        }

        const png = await stickerToImage(media.buffer);
        await interaction.reply({ image: png });
    });
