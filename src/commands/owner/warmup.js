/**
 * @fileoverview Warmup command — toggle the warmup feature on/off.
 * When enabled, the bot sends an empty (invisible) reaction to every
 * incoming command message before processing it. This "warms up" the
 * connection and reduces latency on the actual response.
 *
 * Owner-only.
 * @module commands/owner/warmup
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { statusIcon } from "#libs/utils/format";
import { state } from "#state";

export default new CommandBuilder()
    .setName("warmup")
    .setAliases("wu")
    .setDescription("Toggle connection warmup (empty reaction before reply)")
    .setUsage("{prefix}{name} [on|off]")
    .setExample("{prefix}{name} on")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const value = interaction.rawArgs[0]?.toLowerCase();

        if (!value || (value !== "on" && value !== "off")) {
            return interaction.reply(
                `Warmup: *${statusIcon(state.warmup)}*\nUsage: \`${interaction.prefix}${interaction.commandName} on|off\``,
            );
        }

        state.setWarmup(value === "on");
        return interaction.reply(`Warmup: *${statusIcon(state.warmup)}*`);
    });
