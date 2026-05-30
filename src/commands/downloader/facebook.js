/**
 * @fileoverview Facebook command — download or search videos, reels, and posts.
 * @module commands/downloader/facebook
 */

import axios from "axios";
import facebook from "#libs/scrapers/facebook";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { selectFromList } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("facebook")
    .setAliases("fb", "fbdl", "fbdown")
    .setDescription("Download or search Facebook videos, reels, and posts")
    .setUsage("{prefix}{name} <url|query>")
    .setExample(
        "{prefix}fb https://www.facebook.com/reel/123456\n{prefix}fb kucing lucu\n{prefix}fb tutorial masak",
    )
    .setNote(
        "URL → direct download. Text → search videos, pick a number, download.",
    )
    .setReact("📘")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const input = (
            interaction.body ||
            interaction.quoted?.text ||
            ""
        ).trim();

        if (!input) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <url|query>\``,
            );
        }

        await interaction.typing();

        if (/facebook\.com|fb\.watch/i.test(input)) {
            const result = await facebook.download(input);

            if (result.type === "video") {
                const { data } = await axios.get(result.video, {
                    responseType: "arraybuffer",
                    timeout: 60_000,
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
            return;
        }

        const results = await facebook.search(input, {
            type: "video",
            limit: 10,
        });

        if (!results.length) {
            return interaction.reply(
                `No Facebook videos found for "${input}".`,
            );
        }

        const selected = await selectFromList({
            interaction,
            items: results,
            format: (item, i) => {
                const icon =
                    item.type === "reel"
                        ? "🎬"
                        : item.type === "video"
                          ? "🎥"
                          : "📄";
                const title =
                    item.title.length > 60
                        ? `${item.title.slice(0, 57)}...`
                        : item.title;
                return `${i + 1}. ${icon} ${title}`;
            },
            header: `— *Facebook Search*`,
        });

        if (!selected) {
            return;
        }

        await interaction.typing();

        try {
            const result = await facebook.download(selected.url);

            if (result.type === "video") {
                const { data } = await axios.get(result.video, {
                    responseType: "arraybuffer",
                    timeout: 60_000,
                });

                return interaction.followUp({
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
                await interaction[i === 0 ? "followUp" : "followUp"]({
                    image: { url: imgUrl },
                    ...(i === 0 ? { caption } : {}),
                });
            }
        } catch {
            return interaction.followUp(
                `Could not download. Video might be private.\n\n🔗 ${selected.url}`,
            );
        }
    });
