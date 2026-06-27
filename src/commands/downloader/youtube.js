/**
 * @fileoverview YouTube command — search/download audio/video + community posts.
 * @module commands/downloader/youtube
 */

import youtubePost from "#libs/scrapers/youtube-post";
import * as ytdlp from "#libs/services/downloader/yt-dlp";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatDuration } from "#libs/utils/format";
import { selectFromList } from "#libs/utils/interaction";
import { extractUrl } from "#libs/utils/message";

const FALLBACK_META = {
    title: "YouTube",
    channel: "",
    description: "",
    duration: 0,
    thumbnail: null,
};
const formatResult = (r, i) =>
    `${i + 1}. *${r.title}* - ${r.channel} (${formatDuration(r.duration)})`;

export default new CommandBuilder()
    .setName("youtube")
    .setAliases("yt", "ytdl", "play")
    .setDescription("Search or download YouTube audio/video/community posts")
    .setUsage("{prefix}{name} <query|url> [--video | -v]")
    .setExample("{prefix}{name} yoasobi idol")
    .setReact("▶️")
    .setRateLimit(15_000, 2)
    .setHandler(async (interaction) => {
        const { flags, positional } = interaction.parseFlags({
            video: { type: "boolean", alias: "v" },
        });
        const wantVideo = flags.video === true;

        const body = positional.join(" ").trim();
        const query = (
            extractUrl(body) ||
            body ||
            interaction.quoted?.url ||
            interaction.quoted?.text ||
            ""
        ).trim();

        if (!query) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <query|url> [--video | -v]\``,
            );
        }

        await interaction.typing();

        if (/youtube\.com\/post\//i.test(query)) {
            const post = await youtubePost.download(query);

            const postCaption = [
                `👤 *${post.author}*`,
                `👍 ${post.likes}`,
                ...(post.text ? ["", post.text] : []),
            ].join("\n");

            if (post.images.length) {
                if (post.images.length === 1) {
                    await interaction.reply({
                        image: { url: post.images[0].url },
                        caption: postCaption,
                    });
                } else {
                    await interaction.reply({
                        image: { url: post.images[0].url },
                        caption: postCaption,
                    });
                    const albumItems = post.images.slice(1).map((img) => ({
                        url: img.url,
                        type: "image",
                    }));
                    await interaction.sendAlbum(albumItems);
                }
                return;
            }

            if (post.videos.length) {
                const vid = post.videos[0];
                return interaction.reply(
                    [
                        postCaption,
                        "",
                        `🎬 *${vid.title}*`,
                        ...(vid.duration ? [`⏱ ${vid.duration}`] : []),
                        `🔗 ${vid.url}`,
                    ].join("\n"),
                );
            }

            if (post.poll) {
                const pollLines = post.poll.choices.map(
                    (c, i) => `${i + 1}. ${c.text}`,
                );
                return interaction.reply(
                    [
                        postCaption,
                        "",
                        "📊 *Poll:*",
                        ...pollLines,
                        `Total votes: ${post.poll.totalVotes}`,
                    ].join("\n"),
                );
            }

            return interaction.reply(postCaption);
        }

        let url = query;
        let meta;

        if (
            !/^https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\//i.test(
                query,
            )
        ) {
            const results = await ytdlp.search(query, 10);
            if (!results.length) {
                return interaction.reply("No results found.");
            }

            meta = await selectFromList({
                interaction,
                items: results,
                format: formatResult,
                header: {
                    image: results[0].thumbnail
                        ? { url: results[0].thumbnail }
                        : null,
                    caption: "🔍 *YouTube Search*",
                },
            });
            if (!meta) {
                return;
            }
            url = meta.url;
        }

        meta ??= await ytdlp.info(url).catch(() => FALLBACK_META);

        const desc = meta.description
            ? meta.description.length > 150
                ? `${meta.description.slice(0, 150)}...`
                : meta.description
            : "";

        const caption = [
            `▶️ *${meta.title}*`,
            `👤 ${meta.channel || "-"}`,
            `⏱ ${formatDuration(meta.duration)}`,
            ...(desc ? ["", `📝 ${desc}`] : []),
            "",
            "_Downloading..._",
        ].join("\n");

        await interaction.followUp(
            meta.thumbnail
                ? { image: { url: meta.thumbnail }, caption }
                : caption,
        );

        const type = wantVideo ? "video" : "audio";
        try {
            const result = await ytdlp.download(url, type, {
                title: meta.title,
            });
            return interaction.followUp(
                type === "audio"
                    ? {
                          audio: result.buffer,
                          mimetype: result.mimetype,
                          fileName: result.fileName,
                      }
                    : { video: result.buffer, fileName: result.fileName },
            );
        } catch (err) {
            return interaction.followUp(err.message);
        }
    });
