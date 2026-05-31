/**
 * @fileoverview Upload command — upload media or text to various hosting services.
 * @module commands/tools/upload
 */

import { providers, upload } from "#libs/storage/uploader";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { selectFromList } from "#libs/utils/interaction";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("upload")
    .setAliases("tourl", "tolink")
    .setDescription("Upload media or text to file hosting")
    .setUsage("{prefix}{name} [provider]")
    .setExample("{prefix}{name} catbox")
    .setNote("Reply to media or text message. Provider can be passed directly.")
    .setReact("☁️")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 200 * 1024 * 1024,
        }).catch(() => null);

        let buffer;
        let filename;

        if (media) {
            buffer = media.buffer;
        } else {
            const text = interaction.quoted?.text || interaction.body || "";
            if (!text) {
                return interaction.reply(
                    "Send or reply to a media/text message.",
                );
            }
            buffer = Buffer.from(text, "utf-8");
            filename = "message.txt";
        }

        const arg = interaction.rawArgs[0]?.toLowerCase();
        let selected = arg && providers[arg] ? arg : null;

        if (!selected) {
            const list = Object.keys(providers);
            selected = await selectFromList({
                interaction,
                items: list,
                format: (p, i) => `${i + 1}. ${p}`,
                header: "☁️ *Select Provider*",
            });
            if (!selected) {
                return;
            }
        }

        if (
            (selected === "imgur" || selected === "freeimage") &&
            media?.type !== "image"
        ) {
            return interaction.followUp(`${selected} only supports images.`);
        }

        await interaction.typing();

        try {
            const url = await upload(buffer, filename, selected);
            return interaction.followUp(`☁️ *${selected}*\n📎 ${url}`);
        } catch (err) {
            return interaction.followUp(`Upload failed: ${err.message}`);
        }
    });
