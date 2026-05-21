/**
 * @fileoverview Lyrics command — search and display song lyrics from Genius.
 * @module commands/tools/lyrics
 */

import { getGenius } from "#libs/scrapers/genius";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { selectFromList } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("lyrics")
    .setAliases("lirik", "lyric")
    .setDescription("Search song lyrics from Genius")
    .setUsage("{prefix}{name} <song title / artist>")
    .setExample("{prefix}lyrics yoasobi idol")
    .setReact("🎶")
    .setRateLimit(8_000, 3)
    .setHandler(async (interaction) => {
        const input = interaction.body || interaction.quoted?.text;
        if (!input) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <song title / artist>\``,
            );
        }

        await interaction.typing();
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
                caption: "🎶 *Genius Lyrics Search*",
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
