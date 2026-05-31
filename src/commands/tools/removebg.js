/**
 * @fileoverview Remove background command.
 * @module commands/tools/removebg
 */

import RemoveBG from "#libs/scrapers/removebg";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("removebg")
    .setAliases("rembg", "nobg")
    .setDescription("Remove image background")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}{name}")
    .setNote("Send or reply to an image.")
    .setReact("✂️")
    .setRateLimit(15_000, 2)
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 10 * 1024 * 1024,
        });

        if (media?.type !== "image") {
            return interaction.reply(
                "Send or reply to an image to remove its background.",
            );
        }

        const remover = new RemoveBG();
        const result = await remover.fromBuffer(media.buffer);
        return interaction.reply({ image: result, mimetype: "image/png" });
    });
