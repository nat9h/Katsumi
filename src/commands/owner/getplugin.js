/**
 * @fileoverview GetPlugin command — sends a command plugin file to chat.
 * @module commands/owner/getplugin
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CommandBuilder } from "#structures/CommandBuilder";
import { commandMap } from "#utils/plugin";

const COMMANDS_DIR = join(process.cwd(), "src", "commands");

export default new CommandBuilder()
    .setName("getplugin")
    .setAliases("gp", "getcmd")
    .setDescription("Get a plugin source file")
    .setUsage("{prefix}{name} <command> [-d]")
    .setExample("{prefix}getplugin ping")
    .setNote("Add -d flag to send as document file.")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const args = interaction.rawArgs.filter((a) => a !== "-d");
        const asDocument = interaction.rawArgs.includes("-d");
        const name = args[0]?.toLowerCase();

        if (!name) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <command> [-d]\``,
            );
        }

        const cmd = commandMap.get(name);
        if (!cmd) {
            return interaction.reply(`Command *${name}* not found.`);
        }

        const filePath = join(COMMANDS_DIR, cmd.category, `${cmd.name}.js`);

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
