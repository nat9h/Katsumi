/**
 * @fileoverview Instagram command — download or search posts.
 * URL → download media. Text → search by hashtag.
 * @module commands/downloader/instagram
 */

import axios from "axios";
import instagram from "#libs/scrapers/instagram";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatCount } from "#libs/utils/format";
import { selectFromList } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("instagram")
    .setAliases("ig", "igdl", "igdown", "insta", "igsearch")
    .setDescription("Download or search Instagram posts")
    .setUsage("{prefix}{name} <url|query>")
    .setExample(
        "{prefix}{name} https://www.instagram.com/reel/xxx\n{prefix}ig kucinglucu",
    )
    .setNote("URL → download. Text → search by hashtag.")
    .setReact("📸")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const query = (
            interaction.body ||
            interaction.quoted?.url ||
            interaction.quoted?.text ||
            ""
        ).trim();

        if (!query) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <url|query>\``,
            );
        }

        await interaction.typing();

        if (/(?:instagram\.com|instagr\.am)\//i.test(query)) {
            const post = await instagram.download(query);

            const lines = [
                `👤 *@${post.author.username}*${post.author.fullName ? ` (${post.author.fullName})` : ""}`,
                `❤️ ${formatCount(post.stats.likes)} • 💬 ${formatCount(post.stats.comments)}`,
                ...(post.stats.views
                    ? [`👁 ${formatCount(post.stats.views)} views`]
                    : []),
                ...(post.stats.plays
                    ? [`▶️ ${formatCount(post.stats.plays)} plays`]
                    : []),
            ];

            if (post.caption) {
                lines.push("", post.caption);
            }

            if (post.comments.length) {
                const top = post.comments
                    .sort((a, b) => b.likes - a.likes)
                    .slice(0, 5);
                lines.push("", "💬 *Top Comments:*");
                for (const c of top) {
                    const likeStr = c.likes
                        ? ` (❤️${formatCount(c.likes)})`
                        : "";
                    lines.push(
                        `• @${c.username}: ${c.text.slice(0, 100)}${c.text.length > 100 ? "..." : ""}${likeStr}`,
                    );
                }
            }

            const caption = lines.join("\n");

            for (const [i, media] of post.media.entries()) {
                if (media.type === "video") {
                    const { data } = await axios.get(media.url, {
                        responseType: "arraybuffer",
                        timeout: 60_000,
                    });
                    await interaction.followUp({
                        video: Buffer.from(data),
                        ...(i === 0 ? { caption } : {}),
                    });
                } else {
                    await interaction.followUp({
                        image: { url: media.url },
                        ...(i === 0 ? { caption } : {}),
                    });
                }
            }
        } else {
            const { tag, mediaCount, posts } =
                await instagram.searchPosts(query);

            if (!posts.length) {
                return interaction.reply(`No posts found for #${tag}.`);
            }

            const selected = await selectFromList({
                interaction,
                items: posts,
                format: (p, i) =>
                    `${i + 1}. *@${p.author}* — ${p.caption?.slice(0, 40) || "(no caption)"}${p.caption?.length > 40 ? "..." : ""} (❤️${formatCount(p.likes)})`,
                header: {
                    image: posts[0].thumbnail
                        ? { url: posts[0].thumbnail }
                        : null,
                    caption: `🔎 *#${tag}* — ${formatCount(mediaCount)} posts`,
                },
            });

            if (!selected) {
                return;
            }

            const postUrl = `https://www.instagram.com/p/${selected.shortcode}/`;
            const post = await instagram.download(postUrl);

            const caption = [
                `👤 @${post.author.username}`,
                `❤️ ${formatCount(post.stats.likes)} • 💬 ${formatCount(post.stats.comments)}`,
                "",
                post.caption || "",
            ].join("\n");

            for (const [i, media] of post.media.entries()) {
                if (media.type === "video") {
                    const { data } = await axios.get(media.url, {
                        responseType: "arraybuffer",
                        timeout: 60_000,
                    });
                    await interaction.followUp({
                        video: Buffer.from(data),
                        ...(i === 0 ? { caption } : {}),
                    });
                } else {
                    await interaction.followUp({
                        image: { url: media.url },
                        ...(i === 0 ? { caption } : {}),
                    });
                }
            }
        }
    });
