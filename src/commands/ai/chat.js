/**
 * @fileoverview AI command — chat, image vision, and image generation.
 * @module commands/ai/chat
 */

import { getAI } from "#libs/scrapers/ai";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { truncate } from "#libs/utils/format";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("ai")
    .setAliases("ai", "gpt", "chat")
    .setDescription("Chat with AI, analyze images, or generate images")
    .setUsage("{prefix}{name} <prompt> | --imagine <prompt>")
    .setExample("{prefix}ai Explain what JavaScript is")
    .setNote(
        "Use --imagine to generate images. Send/reply to an image to analyze it.",
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
                    "• Ask anything to AI",
                    "• Send/reply to an image to analyze it",
                    "• Use `--imagine` to generate images from text\n",
                    "*Examples:*",
                    `\`${interaction.prefix}${interaction.commandName} What is machine learning?\``,
                    `\`${interaction.prefix}${interaction.commandName} --imagine a cat in space\``,
                    `_Send image + caption:_ \`${interaction.prefix}${interaction.commandName} What's in this image?\``,
                ].join("\n"),
            );
        }

        const ai = getAI();

        if (flags.imagine) {
            const buffer = await ai.imagine(query);
            return interaction.reply({ image: buffer, caption: query });
        }

        if (isImage) {
            await interaction.reply("Analyzing image...");
            const reply = await ai.vision(media.buffer, {
                prompt: query || "What is in this image? Describe in detail.",
                mimeType:
                    media.type === "sticker" ? "image/webp" : "image/jpeg",
            });
            return interaction.editReply(truncate(reply, 65_000));
        }

        let prompt = text || quoted;
        if (quoted && text && text !== quoted) {
            prompt = `Context: "${quoted}"\n\nQuestion: ${text}`;
        }

        await interaction.reply("Thinking...");
        const reply = await ai.chat(prompt, {
            system: "You are a helpful AI assistant. Answer clearly and concisely.",
        });
        return interaction.editReply(truncate(reply, 65_000));
    });
