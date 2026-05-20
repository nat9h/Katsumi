/**
 * @fileoverview ToAudio command — extracts audio from video as MP3.
 * @module commands/converter/toaudio
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { extractAudio } from "#libs/utils/converter/media";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("toaudio")
    .setAliases("tomp3", "ta")
    .setDescription("Extract audio from a video as MP3")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}toaudio")
    .setReact("🎵")
    .setRateLimit(8000, 3)
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 30 * 1024 * 1024,
        });

        if (!media || (media.type !== "video" && media.type !== "audio")) {
            return interaction.reply(
                "Send or reply to a video (or audio file).",
            );
        }

        const mp3 = await extractAudio(
            media.buffer,
            media.type === "audio" ? "ogg" : "mp4",
        );
        await interaction.reply({ audio: mp3, mimetype: "audio/mpeg" });
    });
