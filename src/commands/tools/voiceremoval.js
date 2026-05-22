/**
 * @fileoverview Voice removal command — separate vocals and instrumentals.
 * @module commands/tools/voiceremoval
 */

import { VocalRemover } from "#libs/scrapers/voiceremoval";
import { uguu } from "#libs/storage/uploader";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("voiceremoval")
    .setAliases("vocalremove", "karaoke", "instrumental")
    .setDescription("Separate vocals and instrumentals from audio")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}voiceremoval")
    .setNote("Send or reply to an audio/video.")
    .setReact("🎵")
    .setRateLimit(30_000, 2)
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 20 * 1024 * 1024,
        });

        if (!media || !["audio", "video"].includes(media.type)) {
            return interaction.reply(
                "Send or reply to an audio/video to separate vocals.",
            );
        }

        const audioUrl = await uguu(media.buffer);
        const vr = new VocalRemover();
        const result = await vr.remove(audioUrl);

        await interaction.reply({
            audio: { url: result.instrumental },
            mimetype: "audio/mpeg",
        });
        return interaction.reply({
            audio: { url: result.vocal },
            mimetype: "audio/mpeg",
        });
    });
