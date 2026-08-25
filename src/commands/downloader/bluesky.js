/**
 * @fileoverview Bluesky command — download post media (images/video).
 * @module commands/downloader/bluesky
 */

import bluesky from "#libs/scrapers/bluesky";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatCount } from "#libs/utils/format";

export default new CommandBuilder()
    .setName("bluesky")
    .setAliases("bsky", "blueskydl")
    .setDescription("Download Bluesky post media")
    .setUsage("{prefix}{name} <url>")
    .setExample(
        "{prefix}{name} https://bsky.app/profile/user.bsky.social/post/abc123",
    )
    .setNote("Supports images and videos.")
    .setReact("🦋")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const query = interaction.urlArg();

        if (!query || !/bsky\.app/i.test(query)) {
            return interaction.reply(interaction.usage());
        }

        await interaction.typing();

        const post = await bluesky.download(query);

        const caption = [
            post.text,
            `👤 ${post.author} (@${post.handle})`,
            `❤️ ${formatCount(post.stats.likes)} • 🔁 ${formatCount(post.stats.reposts)} • 💬 ${formatCount(post.stats.replies)}`,
        ]
            .filter(Boolean)
            .join("\n");

        if (post.media.length > 1) {
            await interaction.sendAlbum(
                post.media.map((m) => ({ url: m.url, type: m.type })),
                { caption },
            );
            return;
        }

        const m = post.media[0];
        await interaction.followUp({
            [m.type]: { url: m.url },
            caption,
        });
    });
