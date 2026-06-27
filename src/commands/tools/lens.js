/**
 * @fileoverview Google Lens command — reverse image search.
 * @module commands/tools/lens
 */

import lens from "#libs/scrapers/lens";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("lens")
    .setAliases("googlelens", "reverse", "gimage")
    .setDescription("Reverse image search")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}{name}")
    .setNote("Send or reply to an image.")
    .setReact("🔍")
    .setGuard("premium") // example usage for premium user
    .setRateLimit(15_000, 2)
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 10 * 1024 * 1024,
        });

        if (media?.type !== "image" && media?.type !== "sticker") {
            return interaction.reply(
                "Send or reply to an image to reverse search.",
            );
        }

        await interaction.typing();

        const { sources } = await lens.search(media.buffer);

        if (sources.length === 0) {
            return interaction.reply("No results found for this image.");
        }

        let caption = "🔍 *Reverse Image Search*\n";
        caption += `_${sources.length} source(s) found_\n`;

        for (const src of sources.slice(0, 10)) {
            const title = src.title || src.domain || "Link";
            caption += `\n• ${title}\n${src.url}\n`;
        }

        return interaction.reply(caption.trim());
    });
