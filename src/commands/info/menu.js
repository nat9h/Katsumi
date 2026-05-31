/**
 * @fileoverview Menu command — displays all available commands grouped by category.
 * @module commands/info/menu
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import {
    groupCommands,
    isVisible,
    renderCategory,
    renderCommandDetail,
    renderFullMenu,
} from "#libs/utils/menu";
import { isOwner } from "#libs/utils/permission";
import { commandMap } from "#libs/utils/plugin";

export default new CommandBuilder()
    .setName("menu")
    .setAliases("help", "h")
    .setDescription("Show all available commands")
    .setUsage("{prefix}{name} [command|category]")
    .setExample("{prefix}{name} info")
    .addOption("query", "string", "command or category name")
    .setHandler(async (interaction) => {
        const prefix = interaction.prefix;
        const input = interaction.args.query?.toLowerCase();
        const viewerIsOwner = isOwner(interaction);
        const groups = groupCommands(viewerIsOwner);

        if (input) {
            const cmd = commandMap.get(input);
            if (cmd && isVisible(cmd, viewerIsOwner)) {
                return interaction.reply(renderCommandDetail(prefix, cmd));
            }
            if (groups[input]?.length) {
                return interaction.reply(
                    renderCategory(prefix, input, groups[input]),
                );
            }
            return interaction.reply(
                `*${input}* is not a command or category.`,
            );
        }

        return interaction.reply({
            text: renderFullMenu(
                prefix,
                interaction.commandName,
                interaction.user,
                groups,
            ),
            mentions: [interaction.user],
        });
    });
