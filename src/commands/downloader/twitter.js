/**
 * @fileoverview Twitter/X command — download, stalk, or trending.
 * URL → download. @username → stalk. "trend" → trending topics.
 * @module commands/downloader/twitter
 */

import axios from "axios";
import twitter from "#libs/scrapers/twitter";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatCount } from "#libs/utils/format";

export default new CommandBuilder()
    .setName("twitter")
    .setAliases("tw", "x", "twdl", "xdl", "twstalk", "xstalk")
    .setDescription("Download tweets, stalk profiles, or view trends")
    .setUsage("{prefix}{name} <url|@user|trend>")
    .setExample(
        "{prefix}tw https://x.com/user/status/123\n{prefix}tw @elonmusk\n{prefix}tw trend",
    )
    .setNote("URL → download. @user → stalk. 'trend' → trending.")
    .setReact("🐦")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const query = (
            interaction.body ||
            interaction.quoted?.text ||
            ""
        ).trim();

        if (!query) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <url|@user|trend>\``,
            );
        }

        await interaction.typing();

        if (/^trends?$/i.test(query)) {
            const trends = await twitter.trending();
            const text = [
                "🔥 *Trending di Indonesia:*",
                "",
                ...trends.slice(0, 20).map((t, i) => {
                    const vol = t.tweetVolume
                        ? ` (${formatCount(t.tweetVolume)})`
                        : "";
                    return `${i + 1}. ${t.name}${vol}`;
                }),
            ].join("\n");
            return interaction.reply(text);
        }

        if (/(?:twitter\.com|x\.com)\/\w+\/status\/\d+/i.test(query)) {
            const tweet = await twitter.download(query);

            const caption = [
                `🐦 *@${tweet.author.username}* (${tweet.author.name})`,
                `❤️ ${formatCount(tweet.stats.likes)} • 🔁 ${formatCount(tweet.stats.retweets)} • 💬 ${formatCount(tweet.stats.replies)}`,
                ...(tweet.stats.views
                    ? [`👁 ${formatCount(tweet.stats.views)} views`]
                    : []),
                "",
                tweet.text,
            ].join("\n");

            if (!tweet.media.length) {
                return interaction.reply(caption);
            }

            for (const [i, media] of tweet.media.entries()) {
                if (media.type === "video" || media.type === "animated_gif") {
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
            return;
        }

        const username = query.replace(/^@/, "");
        const user = await twitter.stalk(username);

        const lines = [
            `*@${user.username}*${user.isVerified ? " ✓" : ""} — ${user.name}`,
            user.bio || "",
            "",
            `Tweets: ${formatCount(user.tweets)} | Followers: ${formatCount(user.followers)} | Following: ${formatCount(user.following)}`,
            `Likes: ${formatCount(user.likes)} | Listed: ${formatCount(user.listed)}`,
            "",
            user.location ? `Location: ${user.location}` : "",
            user.website ? `Link: ${user.website}` : "",
            user.createdAt ? `Joined: ${user.createdAt}` : "",
            user.isProtected ? "(Protected account)" : "",
        ]
            .filter(Boolean)
            .join("\n");

        if (user.avatar) {
            return interaction.reply({
                image: { url: user.avatar },
                caption: lines,
            });
        }

        return interaction.reply(lines);
    });
