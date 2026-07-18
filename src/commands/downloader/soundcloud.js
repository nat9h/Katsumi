/**
 * @fileoverview SoundCloud command — search and download tracks.
 * @module commands/downloader/soundcloud
 */

import axios from "axios";
import { getSoundCloud } from "#libs/scrapers/soundcloud";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatDurationMs, sanitizeFilename } from "#libs/utils/format";
import { selectFromList } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("soundcloud")
    .setAliases("scdl", "scsearch", "sc")
    .setDescription("Search or download SoundCloud tracks")
    .setUsage("{prefix}{name} <query|url>")
    .setExample("{prefix}{name} lofi hip hop")
    .setReact("🎧")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const input = (
            interaction.body ||
            interaction.quoted?.url ||
            interaction.quoted?.text ||
            ""
        ).trim();
        if (!input) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <query|url>\``,
            );
        }

        const sc = getSoundCloud();
        await interaction.typing();

        let track;
        if (/soundcloud\.com\//i.test(input)) {
            const resolved = await sc.resolve(input).catch(() => null);
            if (resolved?.kind !== "track") {
                return interaction.reply("Track not found or unsupported URL.");
            }
            track = {
                title: resolved.title,
                artist: resolved.user?.username ?? null,
                duration_ms: resolved.duration ?? 0,
                url: resolved.permalink_url,
                artwork: resolved.artwork_url,
            };
        } else {
            const tracks = await sc.search(input, { limit: 10 });
            if (!tracks.length) {
                return interaction.reply("No tracks found.");
            }

            track = await selectFromList({
                interaction,
                items: tracks,
                format: (t, i) =>
                    `${i + 1}. *${t.title}* - ${t.artist} (${formatDurationMs(t.duration_ms)})`,
                header: {
                    image: tracks[0].artwork
                        ? { url: tracks[0].artwork }
                        : null,
                    caption: "🎧 *SoundCloud Search*",
                },
            });
            if (!track) {
                return;
            }
        }

        const caption = [
            `🎧 *${track.title}*`,
            `👤 ${track.artist || "-"}`,
            `⏱ ${formatDurationMs(track.duration_ms)}`,
            "",
            "_Downloading..._",
        ].join("\n");

        await interaction.followUp(
            track.artwork
                ? { image: { url: track.artwork }, caption }
                : caption,
        );

        const result = await sc.download(track.url);
        if (!result?.streamUrl) {
            return interaction.followUp("Failed to get stream URL.");
        }

        if (result.protocol === "hls") {
            return interaction.followUp(
                "This track only offers HLS streaming — direct download not supported yet.",
            );
        }

        const { data: buffer } = await axios.get(result.streamUrl, {
            responseType: "arraybuffer",
            timeout: 90_000,
        });

        return interaction.followUp({
            audio: Buffer.from(buffer),
            mimetype: "audio/mpeg",
            fileName: `${sanitizeFilename(track.title)} - ${sanitizeFilename(track.artist || "SoundCloud")}.mp3`,
        });
    });
