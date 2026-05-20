/**
 * @fileoverview Reload command — hot-reloads all command plugins.
 * Owner-only.
 * @module commands/owner/reload
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("reload")
    .setAliases("rl")
    .setDescription("Hot-reload all command plugins")
    .setUsage("{prefix}{name}")
    .setGuard("owner")
    .setReact("♻️")
    .setHandler(async (interaction) => {
        const { loaded, failed } = await interaction.client.reloadPlugins();
        return interaction.reply(
            `♻️ Reloaded *${loaded}* plugin(s)${failed ? ` (${failed} failed)` : ""}`,
        );
    });
