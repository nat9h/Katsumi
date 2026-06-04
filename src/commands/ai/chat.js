/**
 * @fileoverview AI command — chat and image vision via Morphic.
 * @module commands/ai/chat
 */

import { getAI } from "#libs/scrapers/ai";
import morphic from "#libs/scrapers/morphic";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { truncate } from "#libs/utils/format";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("ai")
    .setAliases("ai", "gpt", "chat")
    .setDescription("Chat with AI or analyze images")
    .setUsage("{prefix}{name} <prompt> | --imagine <prompt>")
    .setExample("{prefix}{name} Explain what JavaScript is")
    .setNote(
        "Send/reply to an image to analyze it. Use --imagine to generate images.",
    )
    .setReact("🤖")
    .setRateLimit(10_000, 3)
    .setHandler(async (interaction) => {
        const { flags, positional } = interaction.parseFlags({
            imagine: { type: "boolean", alias: "i" },
        });
        const text = positional.join(" ");
        const quoted = interaction.quoted?.text?.trim();
        const media = await fetchMedia(interaction, {
            maxBytes: 10 * 1024 * 1024,
        });
        const isImage = media?.type === "image" || media?.type === "sticker";
        const query = text || quoted || "";

        if (!query && !isImage) {
            return interaction.reply(
                [
                    "*AI Chat*\n",
                    "*Usage:*",
                    `\`${interaction.prefix}${interaction.commandName} <prompt>\``,
                    `\`${interaction.prefix}${interaction.commandName} --imagine <prompt>\`\n`,
                    "*Features:*",
                    "• Ask anything to AI (powered by Morphic)",
                    "• Send/reply to an image to analyze it",
                    "• Use `--imagine` to generate images from text\n",
                    "*Examples:*",
                    `\`${interaction.prefix}${interaction.commandName} What is machine learning?\``,
                    `\`${interaction.prefix}${interaction.commandName} --imagine a cat in space\``,
                    `_Send image + caption:_ \`${interaction.prefix}${interaction.commandName} What's in this image?\``,
                ].join("\n"),
            );
        }

        if (flags.imagine) {
            const ai = getAI();
            const buffer = await ai.imagine(query);
            return interaction.reply({ image: buffer, caption: query });
        }

        if (isImage) {
            await interaction.reply("Analyzing image...");
            const prompt =
                query || "What is in this image? Describe in detail.";
            const mimeType =
                media.type === "sticker" ? "image/webp" : "image/jpeg";
            const ext = mimeType === "image/webp" ? "webp" : "jpg";

            const result = await morphic.chat(prompt, {
                imageBuffer: media.buffer,
                imageFilename: `image.${ext}`,
                imageMimetype: mimeType,
            });

            return interaction.editReply(truncate(result.text, 65_000));
        }

        let prompt = text || quoted;
        if (quoted && text && text !== quoted) {
            prompt = `Context: "${quoted}"\n\nQuestion: ${text}`;
        }

        await interaction.reply("Thinking...");
        const result = await morphic.chat(prompt);
        return interaction.editReply(truncate(result.text, 65_000));
    });
