/**
 * @fileoverview Plugin management — enable/disable commands globally or per-group.
 * @module commands/owner/plugin
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { groupAllCommands } from "#libs/utils/plugin";
import { state } from "#state";

export default new CommandBuilder()
    .setName("plugin")
    .setAliases("plg")
    .setDescription("Enable or disable plugins (global/per-group)")
    .setUsage(
        "{prefix}{name} <on|off> [command] [--group]\n{prefix}{name} list",
    )
    .setExample(
        "{prefix}{name} off pinterest\n{prefix}{name} off --group\n{prefix}{name} on pinterest\n{prefix}{name} list",
    )
    .setNote(
        "Omit command name to get an interactive list. Use --group for per-group.",
    )
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const { prefix: p, commandName: cmd } = interaction;
        const { flags, positional } = interaction.parseFlags({
            group: { type: "boolean", alias: "g" },
        });

        const action = positional[0]?.toLowerCase();

        if (action === "list" || action === "ls") {
            const globalDisabled = state.getDisabledPlugins();
            const lines = ["*Disabled Plugins*\n"];

            if (globalDisabled.length) {
                lines.push("*Global:*");
                for (const name of globalDisabled) {
                    lines.push(`• ${name}`);
                }
            } else {
                lines.push("*Global:* _none_");
            }

            if (interaction.isGroup) {
                const groupDisabled = state.getDisabledPluginsInGroup(
                    interaction.chatJid,
                );
                lines.push("");
                if (groupDisabled.length) {
                    lines.push("*This group:*");
                    for (const name of groupDisabled) {
                        lines.push(`• ${name}`);
                    }
                } else {
                    lines.push("*This group:* _none_");
                }
            }

            return interaction.reply(lines.join("\n"));
        }

        const isDisable =
            action === "off" || action === "disable" || action === "0";
        const isEnable =
            action === "on" || action === "enable" || action === "1";

        if (!isDisable && !isEnable) {
            return interaction.reply(
                `Usage: \`${p}${cmd} <on|off> [command] [--group]\`\n` +
                    `Or: \`${p}${cmd} list\``,
            );
        }

        let target = positional.slice(1).join(" ").toLowerCase();

        if (!target) {
            const grouped = groupAllCommands();
            const globalDisabled = state.getDisabledPlugins();
            const groupDisabled = interaction.isGroup
                ? state.getDisabledPluginsInGroup(interaction.chatJid)
                : [];

            const items = [];
            const lines = [];
            let idx = 1;

            for (const [cat, cmds] of Object.entries(grouped).sort()) {
                lines.push(
                    `\n*${cat.charAt(0).toUpperCase() + cat.slice(1)}:*`,
                );
                for (const c of cmds.sort((a, b) =>
                    a.name.localeCompare(b.name),
                )) {
                    if (c.name === "plugin") {
                        continue;
                    }
                    const isGlobalOff = globalDisabled.includes(c.name);
                    const isGroupOff = groupDisabled.includes(c.name);
                    const status = isGlobalOff
                        ? "🔴"
                        : isGroupOff
                          ? "🟡"
                          : "🟢";
                    lines.push(`${idx}. ${status} ${c.name}`);
                    items.push(c);
                    idx++;
                }
            }

            const legend = "🟢 on | 🔴 global off | 🟡 group off";
            const prompt = isDisable
                ? "Select command(s) to *disable*"
                : "Select command(s) to *enable*";

            await interaction.reply(
                `📋 *${prompt}:*\n${lines.join("\n")}\n\n${legend}\n\n_Reply with numbers (e.g. 1,2,3 or 1-5 or all)._`,
            );

            try {
                const reply = await interaction.awaitReply(() => true, 60_000);
                const { extractText } = await import("#libs/utils/message");
                const text = extractText(reply.message).trim().toLowerCase();

                let selected;
                if (text === "all" || text === "*") {
                    selected = items.slice();
                } else {
                    const indices = new Set();
                    for (const part of text.split(",")) {
                        const trimmed = part.trim();
                        const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
                        if (rangeMatch) {
                            const start = Number.parseInt(rangeMatch[1], 10);
                            const end = Number.parseInt(rangeMatch[2], 10);
                            for (let i = start; i <= end; i++) {
                                indices.add(i);
                            }
                        } else {
                            const num = Number.parseInt(trimmed, 10);
                            if (!Number.isNaN(num)) {
                                indices.add(num);
                            }
                        }
                    }
                    selected = [...indices]
                        .filter((n) => n >= 1 && n <= items.length)
                        .map((n) => items[n - 1]);
                }

                if (!selected.length) {
                    return interaction.followUp("Invalid. Cancelled.");
                }

                target = selected.map((c) => c.name);
            } catch {
                return interaction.followUp("⏰ Timeout.");
            }
        } else {
            const cmdName = resolveCommandName(target);
            if (!cmdName) {
                return interaction.reply(
                    `Command "${target}" not found. Use the primary name or alias.`,
                );
            }
            if (cmdName === "plugin") {
                return interaction.reply("Cannot disable the plugin command.");
            }
            target = [cmdName];
        }

        let groupJid = null;
        if (flags.group) {
            if (interaction.isGroup) {
                groupJid = interaction.chatJid;
            } else {
                const groups = interaction.store.getAllGroups();
                if (!groups.length) {
                    return interaction.reply("No groups available.");
                }
                const picked = await interaction.pickFromList(
                    groups,
                    "Select group",
                );
                if (!picked) {
                    return;
                }
                groupJid = picked.id;
            }
        }

        const results = [];
        for (const name of target) {
            if (groupJid) {
                if (isDisable) {
                    state.disablePluginInGroup(groupJid, name);
                } else {
                    state.enablePluginInGroup(groupJid, name);
                }
            } else {
                if (isDisable) {
                    state.disablePlugin(name);
                } else {
                    state.enablePlugin(name);
                }
            }
            results.push(name);
        }

        const icon = isDisable ? "🔴" : "🟢";
        const verb = isDisable ? "disabled" : "enabled";
        const scope = groupJid ? "in group" : "globally";

        if (results.length === 1) {
            return interaction.followUp(
                `${icon} *${results[0]}* ${verb} ${scope}.`,
            );
        }
        return interaction.followUp(
            `${icon} ${verb} ${scope} (${results.length}):\n${results.map((n) => `• ${n}`).join("\n")}`,
        );
    });
