/**
 * @fileoverview Prefix command — manages bot command prefixes.
 * Supports add, delete, reset, and no-prefix mode toggle.
 * Owner-only.
 * @module commands/owner/prefix
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { state } from "#state";

export default new CommandBuilder()
    .setName("prefix")
    .setDescription("Manage bot prefixes (owner only)")
    .setUsage("{prefix}{name} <add|del|reset|noprefix> [value]")
    .setExample("{prefix}{name} add /")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const { prefix: p, commandName: cmd, rawArgs } = interaction;
        const sub = rawArgs[0]?.toLowerCase();
        const value = rawArgs[1];

        const list = () => state.prefixes.map((x) => `\`${x}\``).join(", ");

        switch (sub) {
            case undefined: {
                const np = state.noPrefix ? "✅" : "❌";
                return interaction.reply(
                    `*Prefixes:* ${list()}\n*No-prefix:* ${np}`,
                );
            }

            case "add": {
                if (!value) {
                    return interaction.reply(
                        `Usage: \`${p}${cmd} add <char>\``,
                    );
                }
                if (state.prefixes.includes(value)) {
                    return interaction.reply(`\`${value}\` already exists.`);
                }
                state.addPrefix(value);
                return interaction.reply(
                    `Added: \`${value}\`\nCurrent: ${list()}`,
                );
            }

            case "del":
            case "delete":
            case "rm": {
                if (!value) {
                    return interaction.reply(
                        `Usage: \`${p}${cmd} del <char>\``,
                    );
                }
                if (!state.prefixes.includes(value)) {
                    return interaction.reply(`\`${value}\` not found.`);
                }
                if (state.prefixes.length <= 1) {
                    return interaction.reply("Can't remove the last prefix.");
                }
                state.removePrefix(value);
                return interaction.reply(
                    `Removed: \`${value}\`\nCurrent: ${list()}`,
                );
            }

            case "reset": {
                state.resetPrefixes();
                return interaction.reply(`Reset to default: ${list()}`);
            }

            case "noprefix":
            case "np": {
                const v = value?.toLowerCase();
                if (v !== "on" && v !== "off") {
                    const np = state.noPrefix ? "✅" : "❌";
                    return interaction.reply(
                        `No-prefix: *${np}*\nUsage: \`${p}${cmd} noprefix on|off\``,
                    );
                }
                state.setNoPrefix(v === "on");
                return interaction.reply(
                    state.noPrefix
                        ? "✅ No-prefix *enabled* — owner can use commands without prefix."
                        : "❌ No-prefix *disabled* — prefix required for everyone.",
                );
            }

            default:
                return interaction.reply(
                    `Unknown: *${sub}*\nAvailable: \`add\`, \`del\`, \`reset\`, \`noprefix\``,
                );
        }
    });
