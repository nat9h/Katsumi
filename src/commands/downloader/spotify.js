import { Spotify } from "#libs/scrapers/spotify";
import * as ytdlp from "#libs/services/downloader/yt-dlp";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatDurationMs, sanitizeFilename } from "#libs/utils/format";
import { selectFromList } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("spotify")
    .setAliases("spdl", "spsearch")
    .setDescription("Search or download Spotify tracks")
    .setUsage("{prefix}{name} <query|url>")
    .setExample("{prefix}spotify yoasobi idol")
    .setReact("🎵")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const input = interaction.body || interaction.quoted?.text;
        if (!input) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <query|url>\``,
            );
        }

        const sp = new Spotify();
        await interaction.typing();

        let track;
        if (/open\.spotify\.com|spotify:/i.test(input)) {
            track = await sp.getTrack(input);
            if (!track) {
                return interaction.reply("Track not found.");
            }
        } else {
            const tracks = await sp.search(input, { limit: 10 });
            if (!tracks.length) {
                return interaction.reply("No tracks found.");
            }

            const formatTrack = (t, i) => {
                const artists = t.artists.map((a) => a.name).join(", ");
                return `${i + 1}. *${t.name}* - ${artists} (${formatDurationMs(t.duration_ms)})`;
            };

            track = await selectFromList({
                interaction,
                items: tracks,
                format: formatTrack,
                header: {
                    image: tracks[0].album?.image
                        ? { url: tracks[0].album.image }
                        : null,
                    caption: "🎵 *Spotify Search*",
                },
            });
            if (!track) {
                return;
            }
        }

        const artists = track.artists.map((a) => a.name).join(", ");
        const caption = [
            `🎵 *${track.name}*`,
            `👤 ${artists}`,
            `💿 ${track.album?.name || "-"}`,
            `⏱ ${formatDurationMs(track.duration_ms)}`,
            "",
            "_Downloading..._",
        ].join("\n");

        const thumbnail = track.album?.image;
        await interaction.followUp(
            thumbnail ? { image: { url: thumbnail }, caption } : caption,
        );

        const ytResults = await ytdlp.search(`${track.name} ${artists}`, 1);
        if (!ytResults.length) {
            return interaction.followUp("Audio source not found.");
        }

        try {
            const result = await ytdlp.download(ytResults[0].url, "audio", {
                title: track.name,
            });
            return interaction.followUp({
                audio: result.buffer,
                mimetype: result.mimetype,
                fileName: `${sanitizeFilename(track.name)} - ${sanitizeFilename(artists)}.m4a`,
            });
        } catch (err) {
            return interaction.followUp(err.message);
        }
    });
