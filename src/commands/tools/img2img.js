/**
 * @fileoverview Image-to-image command — transform images with AI using a prompt.
 * @module commands/tools/img2img
 */

import { Image2Image } from "#libs/scrapers/img2img";
import { uguu } from "#libs/storage/uploader";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("img2img")
    .setAliases("i2i", "transform")
    .setDescription("Transform an image with AI using a text prompt")
    .setUsage("{prefix}{name} <prompt>")
    .setExample("{prefix}{name} anime style, colorful")
    .setNote("Send or reply to an image with a prompt describing the style.")
    .setReact("🎨")
    .setRateLimit(20_000, 2)
    .setHandler(async (interaction) => {
        const prompt = interaction.rawBody.trim();
        const media = await fetchMedia(interaction, {
            maxBytes: 10 * 1024 * 1024,
        });

        if (media?.type !== "image" && media?.type !== "sticker") {
            return interaction.reply(
                "Send or reply to an image with a style prompt.",
            );
        }

        if (!prompt) {
            return interaction.reply(
                `Provide a prompt describing the style.\n\nExample: \`${interaction.prefix}${interaction.commandName} anime style, vibrant colors\``,
            );
        }

        const imageUrl = await uguu(media.buffer);
        const transformer = new Image2Image();
        const result = await transformer.process(imageUrl, prompt);
        return interaction.reply({ image: result.buffer, caption: prompt });
    });
