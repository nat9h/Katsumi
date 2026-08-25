/**
 * @fileoverview Lyrics command — search and display song lyrics (LRCLIB + Genius fallback).
 * @module commands/tools/lyrics
 */

import { getGenius } from "#libs/scrapers/genius";
import { formatSynced, getLrcLib } from "#libs/scrapers/lrclib";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { selectFromList } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("lyrics")
    .setAliases("lirik", "lyric")
    .setDescription("Search song lyrics (synced & plain)")
    .setUsage("{prefix}{name} <song title / artist>")
    .setExample("{prefix}{name} yoasobi idol")
    .setReact("🎶")
    .setRateLimit(8_000, 3)
    .setHandler(async (interaction) => {
        const input = interaction.body || interaction.quoted?.text;
        if (!input) {
            return interaction.reply(interaction.usage());
        }

        await interaction.typing();

        const lrclib = getLrcLib();
        let lrcResults = [];

        try {
            lrcResults = await lrclib.search(input);
        } catch (err) {
            console.warn(
                "[lyrics] LRCLIB failed, falling back to Genius:",
                err.message,
            );
        }

        if (lrcResults.length) {
            const withLyrics = lrcResults.filter(
                (r) => !r.instrumental && (r.plainLyrics || r.syncedLyrics),
            );

            if (withLyrics.length) {
                const formatTrack = (t, i) =>
                    `${i + 1}. *${t.trackName}* - ${t.artistName}${t.albumName ? ` (${t.albumName})` : ""}`;

                const selected = await selectFromList({
                    interaction,
                    items: withLyrics.slice(0, 10),
                    format: formatTrack,
                    header: { caption: "🎶 *Lyrics Search* (LRCLIB)" },
                });
                if (!selected) {
                    return;
                }

                const lyrics = selected.syncedLyrics
                    ? formatSynced(selected.syncedLyrics)
                    : selected.plainLyrics;

                const caption = [
                    `*${selected.trackName}* — ${selected.artistName}`,
                    selected.albumName ? `_${selected.albumName}_` : "",
                    selected.syncedLyrics ? "⏱️ Synced lyrics" : "",
                    "",
                    lyrics,
                ]
                    .filter(Boolean)
                    .join("\n");

                return interaction.reply(caption);
            }
        }

        const genius = getGenius();
        const results = await genius.search(input, { limit: 10 });

        if (!results.length) {
            return interaction.reply("No results found.");
        }

        const formatSong = (s, i) => `${i + 1}. *${s.title}* - ${s.artist}`;

        const selected = await selectFromList({
            interaction,
            items: results,
            format: formatSong,
            header: {
                image: results[0].thumbnail
                    ? { url: results[0].thumbnail }
                    : null,
                caption: "🎶 *Lyrics Search* (Genius)",
            },
        });
        if (!selected) {
            return;
        }

        await interaction.typing();
        const lyrics = await genius.lyrics(selected.url);

        const caption = [
            `*${selected.title}* — ${selected.artist}`,
            "",
            lyrics,
        ].join("\n");

        return interaction.reply(
            selected.thumbnail
                ? { image: { url: selected.thumbnail }, caption }
                : caption,
        );
    });
