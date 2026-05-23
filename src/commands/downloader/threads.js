/**
 * @fileoverview Threads command — download media from Threads posts.
 * @module commands/downloader/threads
 */

import axios from "axios";
import { threads } from "#libs/scrapers/threads";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("threads")
    .setAliases("th", "thread")
    .setDescription("Download media from Threads posts")
    .setUsage("{prefix}{name} <url>")
    .setExample("{prefix}threads https://www.threads.net/@user/post/ABC123")
    .setReact("🧵")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const url = (interaction.body || interaction.quoted?.text || "").trim();

        if (!url || !/threads\.net/i.test(url)) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <threads url>\``,
            );
        }

        await interaction.typing();

        const post = await threads(url);
        const caption = post.caption || "";

        for (const [i, mediaUrl] of post.media.entries()) {
            const isVideo = /\.mp4|video/i.test(mediaUrl);

            if (isVideo) {
                const { data } = await axios.get(mediaUrl, {
                    responseType: "arraybuffer",
                    timeout: 60_000,
                });
                await interaction.followUp({
                    video: Buffer.from(data),
                    ...(i === 0 && caption ? { caption } : {}),
                });
            } else {
                await interaction.followUp({
                    image: { url: mediaUrl },
                    ...(i === 0 && caption ? { caption } : {}),
                });
            }
        }
    });
