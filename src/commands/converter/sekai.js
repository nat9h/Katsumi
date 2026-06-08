/**
 * @fileoverview Project Sekai sticker maker command.
 * Generates stickers with custom text using characters from Project Sekai.
 * @module commands/converter/sekai
 */

import sekai from "#libs/scrapers/sekai-sticker";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { createSticker } from "#libs/utils/converter/sticker";

export default new CommandBuilder()
    .setName("sekai")
    .setAliases("pjsk", "sekaimaker", "pjsekai")
    .setDescription("Project Sekai sticker maker with custom text")
    .setUsage("{prefix}{name} <character> <text>")
    .setExample("{prefix}{name} emu Wonderhoy!")
    .setNote(
        [
            "Create Project Sekai stickers with custom text!",
            "",
            "Options:",
            "  -i <number> : pick sticker pose (varies per character)",
            "  -s <number> : font size override",
            "",
            "Examples:",
            "  {prefix}{name} emu Wonderhoy!",
            "  {prefix}{name} miku -i 3 Let's go!",
            "  {prefix}{name} kanade Good night",
            "",
            "Use '{prefix}{name} list' to see all characters.",
        ].join("\n"),
    )
    .setReact("🎨")
    .setRateLimit(5000, 3)
    .setHandler(async (interaction) => {
        const { flags, positional } = interaction.parseFlags({
            i: { type: "number" },
            s: { type: "number" },
        });

        const args = positional.join(" ").trim();

        if (!args || args.toLowerCase() === "list") {
            await interaction.typing();
            const stickers = await sekai.search("");
            const characters = await sekai.getCharacters();
            const grouped = {};
            for (const s of stickers) {
                const c = s.character;
                if (!grouped[c]) {
                    grouped[c] = { count: 0, img: s.img };
                }
                grouped[c].count++;
            }

            const list = characters
                .map((c) => {
                    const info = grouped[c] || { count: 0 };
                    return `• *${c}* — ${info.count} poses`;
                })
                .join("\n");

            return interaction.reply(
                `*Project Sekai Sticker Maker*\n\n` +
                    `${list}\n\n` +
                    `Usage: \`${interaction.prefix}${interaction.commandName} <character> <text>\`\n` +
                    `Example: \`${interaction.prefix}${interaction.commandName} emu Wonderhoy!\``,
            );
        }

        const parts = args.split(/\s+/);
        const characterInput = parts[0].toLowerCase();
        const text = parts.slice(1).join(" ");

        if (!text) {
            return interaction.reply(
                `Please provide text for the sticker.\n\n` +
                    `Usage: \`${interaction.prefix}${interaction.commandName} <character> <text>\`\n` +
                    `Example: \`${interaction.prefix}${interaction.commandName} emu Wonderhoy!\``,
            );
        }

        const characters = await sekai.getCharacters();
        const matched =
            characters.find((c) => c === characterInput) ||
            characters.find((c) => c.startsWith(characterInput));

        if (!matched) {
            return interaction.reply(
                `Character "${characterInput}" not found.\n\n` +
                    `Available characters:\n${characters.join(", ")}\n\n` +
                    `Use \`${interaction.prefix}${interaction.commandName} list\` for the full list.`,
            );
        }

        await interaction.typing();

        const buffer = await sekai.make({
            character: matched,
            text,
            index: flags.i ?? 0,
            fontSize: flags.s,
        });

        const sticker = await createSticker(buffer, false, {
            pack: "Project Sekai",
            author: "st.ayaka.one",
        });

        return interaction.reply({ sticker });
    });
