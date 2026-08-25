/**
 * @fileoverview GetPlugin command — sends a command plugin file to chat.
 * @module commands/owner/getplugin
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { commandMap } from "#libs/utils/plugin";

const commandsDir = join(process.cwd(), "src", "commands");

export default new CommandBuilder()
    .setName("getplugin")
    .setAliases("gp", "getcmd")
    .setDescription("Get a plugin source file")
    .setUsage("{prefix}{name} <command> [-d]")
    .setExample("{prefix}{name} ping")
    .setNote("Add -d flag to send as document file.")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const { flags, positional } = interaction.parseFlags({
            document: { type: "boolean", alias: "d" },
        });
        const asDocument = flags.document === true;
        const name = positional[0]?.toLowerCase();

        if (!name) {
            return interaction.reply(interaction.usage());
        }

        const cmd = commandMap.get(name);
        if (!cmd) {
            return interaction.reply(`Command *${name}* not found.`);
        }

        const filePath = join(
            commandsDir,
            cmd.category,
            cmd.fileName || `${cmd.name}.js`,
        );

        try {
            const content = await readFile(filePath, "utf-8");

            if (asDocument) {
                await interaction.reply({
                    document: Buffer.from(content, "utf-8"),
                    mimetype: "application/javascript",
                    fileName: `${cmd.name}.js`,
                    caption: `*${cmd.name}.js* [${cmd.category}]`,
                });
            } else {
                await interaction.reply(
                    `*${cmd.name}.js* [${cmd.category}]\n\n\`\`\`${content}\`\`\``,
                );
            }
        } catch (err) {
            return interaction.reply(`Failed to read file: ${err.message}`);
        }
    });
