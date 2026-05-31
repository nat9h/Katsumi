/**
 * @fileoverview DelFile command — deletes a file or folder by path.
 * @module commands/owner/delfile
 */

import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("delfile")
    .setAliases("df", "deletefile")
    .setDescription("Delete a file or folder")
    .setUsage("{prefix}{name} <path>")
    .setExample("{prefix}{name} src/commands/tools/test.js")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const targetPath = interaction.body;
        if (!targetPath) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <path>\``,
            );
        }

        const filePath = join(process.cwd(), targetPath);
        if (!existsSync(filePath)) {
            return interaction.reply(`Not found: \`${targetPath}\``);
        }

        const isDir = statSync(filePath).isDirectory();
        rmSync(filePath, { recursive: true, force: true });

        return interaction.reply(
            `Deleted ${isDir ? "folder" : "file"}: \`${targetPath}\``,
        );
    });
