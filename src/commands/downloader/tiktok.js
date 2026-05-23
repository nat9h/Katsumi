/**
 * @fileoverview TikTok command — download or search TikTok videos.
 * @module commands/downloader/tiktok
 */

import axios from "axios";
import * as tiktok from "#libs/scrapers/tiktok";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatCount, formatDuration } from "#libs/utils/format";
import { selectFromList } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("tiktok")
    .setAliases("tt", "ttdl", "ttsearch")
    .setDescription("Download or search TikTok videos")
    .setUsage("{prefix}{name} <url|query>")
    .setExample("{prefix}tt https://vt.tiktok.com/xxx")
    .setNote("Without URL, searches TikTok. Sends video + audio automatically.")
    .setReact("🎵")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const query = (
            interaction.body ||
            interaction.quoted?.text ||
            ""
        ).trim();

        if (!query) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <url|query>\``,
            );
        }

        await interaction.typing();

        let post;

        if (/(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i.test(query)) {
            post = await tiktok.download(query);
        } else {
            const list = await tiktok.search(query, { count: 10 });

            post = await selectFromList({
                interaction,
                items: list,
                format: (v, i) =>
                    `${i + 1}. *${v.title?.slice(0, 50) || "Untitled"}* - @${v.author.name} (${formatDuration(v.duration)}) • ${formatCount(v.stats.views)} views`,
                header: {
                    image: list[0].cover ? { url: list[0].cover } : null,
                    caption: "🔍 *TikTok Search*",
                },
            });
            if (!post) {
                return;
            }
        }

        const { stats } = post;
        const text = [
            `🎵 *${post.title || "TikTok Video"}*`,
            "",
            `👤 @${post.author.name} (${post.author.nickname})`,
            `⏱ ${formatDuration(post.duration)}`,
            `❤️ ${formatCount(stats.likes)} • 💬 ${formatCount(stats.comments)} • 🔁 ${formatCount(stats.shares)}`,
            `👁 ${formatCount(stats.views)}`,
            ...(post.musicInfo.title
                ? [`🎶 ${post.musicInfo.title} - ${post.musicInfo.author}`]
                : []),
        ].join("\n");

        // Slideshow
        if (post.images?.length) {
            await interaction.reply({
                image: { url: post.images[0] },
                caption: text,
            });
            for (const url of post.images.slice(1)) {
                await interaction.followUp({ image: { url } });
            }
            if (post.music) {
                const { data } = await axios.get(post.music, {
                    responseType: "arraybuffer",
                    timeout: 30_000,
                });
                await interaction.followUp({
                    audio: Buffer.from(data),
                    mimetype: "audio/mpeg",
                    fileName: `${post.musicInfo.title || "audio"}.mp3`,
                });
            }
            return;
        }

        if (!post.video) {
            return interaction.reply("Video URL not available.");
        }

        const vid = await axios.get(post.video, {
            responseType: "arraybuffer",
            timeout: 60_000,
        });
        await interaction.followUp({
            video: Buffer.from(vid.data),
            caption: text.trim(),
        });

        if (post.music) {
            const aud = await axios.get(post.music, {
                responseType: "arraybuffer",
                timeout: 30_000,
            });
            await interaction.followUp({
                audio: Buffer.from(aud.data),
                mimetype: "audio/mpeg",
                fileName: `${post.musicInfo.title || post.title || "tiktok"}.mp3`,
            });
        }
    });
