/**
 * @fileoverview Outpainting command — expand image borders using AI.
 * @module commands/tools/outpainting
 */

import { Outpainting } from "#libs/scrapers/outpainting";
import { uguu } from "#libs/storage/uploader";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("outpaint")
    .setAliases("expand")
    .setDescription("Expand image borders using AI outpainting")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}outpaint")
    .setNote("Send or reply to an image.")
    .setReact("🖼️")
    .setRateLimit(15_000, 2)
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 10 * 1024 * 1024,
        });

        if (media?.type !== "image" && media?.type !== "sticker") {
            return interaction.reply("Send or reply to an image to expand it.");
        }

        const imageUrl = await uguu(media.buffer);
        const outpainter = new Outpainting();
        const result = await outpainter.process(imageUrl);
        return interaction.reply({ image: result.buffer });
    });
