/**
 * @fileoverview WhatsMusic command — recognize songs from audio using Shazam.
 * @module commands/tools/whatsmusic
 */

import shazam from "#libs/scrapers/shazam";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { toWav } from "#libs/utils/converter/media";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("whatsmusic")
    .setAliases("shazam", "whatmusic", "wm", "recognize")
    .setDescription("Recognize a song from audio using Shazam")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}{name}")
    .setNote("Send or reply to an audio/video/voice note.")
    .setReact("🎵")
    .setRateLimit(15_000, 2)
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 15 * 1024 * 1024,
        });

        if (!media || !["audio", "video"].includes(media.type)) {
            return interaction.reply(
                "Send or reply to an audio/video/voice note to recognize the song.",
            );
        }

        await interaction.typing();

        const inExt = media.type === "audio" ? "ogg" : "mp4";
        const wavBuffer = await toWav(media.buffer, inExt);

        const result = await shazam.recognize(wavBuffer);

        if (!result) {
            return interaction.reply(
                "No match found. Make sure the audio contains clear music (not just voice/noise).",
            );
        }

        const caption = [
            `🎵 *Song Recognized*`,
            "",
            `*Title:* ${result.title}`,
            `*Artist:* ${result.artist}`,
            result.album ? `*Album:* ${result.album}` : "",
            result.year ? `*Year:* ${result.year}` : "",
            result.genre ? `*Genre:* ${result.genre}` : "",
            result.label ? `*Label:* ${result.label}` : "",
            "",
            result.shazamUrl ? `*Link:* ${result.shazamUrl}` : "",
            result.spotify ? `🎧 Spotify: ${result.spotify}` : "",
        ]
            .filter(Boolean)
            .join("\n");

        if (result.coverArt) {
            return interaction.reply({
                image: { url: result.coverArtHQ || result.coverArt },
                caption,
            });
        }

        return interaction.reply(caption);
    });
