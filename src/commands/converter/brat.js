/**
 * @fileoverview Brat — Generate a brat-style sticker from text.
 * Fetches from shinana-brat API which returns an image buffer directly,
 * then converts it to a WhatsApp sticker.
 * @module commands/converter/brat
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { createSticker } from "#libs/utils/converter/sticker";

const API_BASE = "https://shinana-brat.hf.space/";

export default new CommandBuilder()
    .setName("brat")
    .setDescription("Generate a brat-style text sticker.")
    .setUsage("{prefix}{name} <text>")
    .setExample("{prefix}brat halo semua")
    .setReact("📃")
    .setRateLimit(5_000, 3)
    .setHandler(async (interaction) => {
        const text = interaction.body || interaction.quoted?.text || "";

        if (!text) {
            return interaction.reply(
                "Provide text for the sticker.\n\nExample: `brat halo semua`",
            );
        }

        let buffer;

        try {
            const url = new URL(API_BASE);
            url.searchParams.set("text", text);

            const res = await fetch(url.toString());

            if (!res.ok) {
                return interaction.reply(
                    `API error: ${res.status} ${res.statusText}`,
                );
            }

            const arrayBuffer = await res.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
        } catch (err) {
            return interaction.reply(
                `Failed to fetch brat image: ${err.message}`,
            );
        }

        let sticker;

        try {
            sticker = await createSticker(buffer, false, {
                pack: "brat-api",
                author: interaction.userName,
            });
        } catch (err) {
            return interaction.reply(
                `Failed to create sticker: ${err.message}`,
            );
        }

        return interaction.reply({ sticker });
    });
