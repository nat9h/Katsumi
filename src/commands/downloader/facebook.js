/**
 * @fileoverview Facebook command — download videos, reels, and image posts.
 * @module commands/downloader/facebook
 */

import axios from "axios";
import facebook from "#libs/scrapers/facebook";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("facebook")
    .setAliases("fb", "fbdl", "fbdown")
    .setDescription("Download Facebook videos, reels, or image posts")
    .setUsage("{prefix}{name} <url>")
    .setExample(
        "{prefix}fb https://www.facebook.com/reel/123456\n{prefix}fb https://www.facebook.com/share/p/abc123/",
    )
    .setNote("Supports videos, reels, and photo posts (single & multi-image).")
    .setReact("📘")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const url = (interaction.body || interaction.quoted?.text || "").trim();

        if (!url) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <url>\``,
            );
        }

        if (!/facebook\.com|fb\.watch/i.test(url)) {
            return interaction.reply("Please provide a valid Facebook URL.");
        }

        await interaction.typing();
        const result = await facebook.download(url);

        if (result.type === "video") {
            const { data } = await axios.get(result.video, {
                responseType: "arraybuffer",
            });

            return interaction.reply({
                video: Buffer.from(data),
                caption: result.title
                    ? `*Facebook Video*\n\n${result.title}`
                    : "*Facebook Video*",
            });
        }

        const caption = result.title
            ? `*Facebook Post*\n\n${result.title}\n\n📷 ${result.images.length} image(s)`
            : `*Facebook Post*\n\n📷 ${result.images.length} image(s)`;

        for (const [i, imgUrl] of result.images.entries()) {
            await interaction[i === 0 ? "reply" : "followUp"]({
                image: { url: imgUrl },
                ...(i === 0 ? { caption } : {}),
            });
        }
    });
