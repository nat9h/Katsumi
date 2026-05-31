/**
 * @fileoverview Brat — Generate a brat-style sticker from text.
 * Fetches from shinana-brat API which returns an image buffer directly,
 * then converts it to a WhatsApp sticker.
 * @module commands/converter/brat
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { createSticker } from "#libs/utils/converter/sticker";

export default new CommandBuilder()
    .setName("brat")
    .setDescription("Generate a brat-style text sticker.")
    .setUsage("{prefix}{name} <text>")
    .setExample("{prefix}{name} hi everyone!")
    .setReact("📃")
    .setRateLimit(5_000, 3)
    .setHandler(async (interaction) => {
        const text = interaction.body || interaction.quoted?.text || "";

        if (!text) {
            return interaction.reply(
                `Provide text for the sticker.\n\nExample: \`${interaction.prefix}${interaction.commandName} hi everyone!\``,
            );
        }

        const url = new URL("https://shinana-brat.hf.space/");
        url.searchParams.set("text", text);

        const res = await fetch(url.toString());

        if (!res.ok) {
            return interaction.reply(
                `API error: ${res.status} ${res.statusText}`,
            );
        }

        const buffer = Buffer.from(await res.arrayBuffer());

        const sticker = await createSticker(buffer, false, {
            pack: "brat-api",
            author: interaction.userName,
        });

        return interaction.reply({ sticker });
    });
