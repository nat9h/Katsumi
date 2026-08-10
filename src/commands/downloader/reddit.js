/**
 * @fileoverview Reddit command — download post media.
 * Supports: images, videos (with audio), galleries.
 * @module commands/downloader/reddit
 */

import reddit from "#libs/scrapers/reddit";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { mergeVideoAudio } from "#libs/utils/converter/media";
import { formatCount } from "#libs/utils/format";
import { extractUrl } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("reddit")
    .setAliases("rd", "redditdl")
    .setDescription("Download Reddit post media")
    .setUsage("{prefix}{name} <url>")
    .setExample(
        "{prefix}{name} https://www.reddit.com/r/subreddit/comments/xxx/title\n{prefix}{name} https://www.reddit.com/s/xxxxx",
    )
    .setNote("Supports images, videos (with audio), and galleries.")
    .setReact("🔴")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const query = (
            extractUrl(interaction.body) ||
            interaction.body ||
            interaction.quoted?.url ||
            interaction.quoted?.text ||
            ""
        ).trim();

        if (!query) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <url>\``,
            );
        }

        if (!/reddit\.com|redd\.it/i.test(query)) {
            return interaction.reply("Please provide a valid Reddit URL.");
        }

        await interaction.typing();

        const post = await reddit.download(query);

        const caption = [
            `📌 *${post.title}*`,
            `👤 u/${post.author} • ${post.subreddit}`,
            `⬆️ ${formatCount(post.stats.upvotes)} • 💬 ${formatCount(post.stats.comments)}`,
        ].join("\n");

        if (post.media.length > 1) {
            const albumItems = [];
            for (const m of post.media) {
                if (m.type === "video") {
                    const vBuf = await reddit.downloadBuffer(m.url);
                    if (m.audioUrl) {
                        try {
                            const aBuf = await reddit.downloadBuffer(
                                m.audioUrl,
                            );
                            albumItems.push({
                                buffer: await mergeVideoAudio(vBuf, aBuf),
                                type: "video",
                            });
                        } catch (e) {
                            if (e.response?.status !== 403) {
                                throw e;
                            }
                            albumItems.push({ buffer: vBuf, type: "video" });
                        }
                    } else {
                        albumItems.push({ buffer: vBuf, type: "video" });
                    }
                } else {
                    albumItems.push({ url: m.url, type: "image" });
                }
            }
            await interaction.sendAlbum(albumItems, { caption });
            return;
        }

        const m = post.media[0];
        if (m.type === "video") {
            const vBuf = await reddit.downloadBuffer(m.url);
            let finalBuf = vBuf;
            if (m.audioUrl) {
                try {
                    const aBuf = await reddit.downloadBuffer(m.audioUrl);
                    finalBuf = await mergeVideoAudio(vBuf, aBuf);
                } catch (e) {
                    if (e.response?.status !== 403) {
                        throw e;
                    }
                }
            }
            await interaction.followUp({
                video: finalBuf,
                caption,
            });
        } else {
            await interaction.followUp({
                image: { url: m.url },
                caption,
            });
        }
    });
