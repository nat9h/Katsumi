/**
 * @fileoverview Premium command — manage premium users (owner only).
 * @module commands/owner/premium
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatExpiry, parseDuration } from "#libs/utils/format";
import { resolveUserTarget } from "#libs/utils/message";
import {
    addPremium,
    getExpiry,
    listPremium,
    removePremium,
} from "#libs/utils/premium";

export default new CommandBuilder()
    .setName("premium")
    .setAliases("prem")
    .setDescription("Manage premium users (owner only)")
    .setUsage("{prefix}{name} <add|del|list|check> [user] [duration]")
    .setExample("{prefix}{name} add @user 30d")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const action = interaction.rawArgs[0]?.toLowerCase();
        const value = interaction.rawArgs.slice(1).join(" ");

        switch (action) {
            case "add": {
                const parts = value.split(/\s+/);
                const durationStr = parts.pop();
                const targetStr = parts.join(" ");
                const target = resolveUserTarget(interaction, targetStr);

                if (!target) {
                    return interaction.reply(
                        `Please mention, reply, or provide a number.\n${interaction.example()}`,
                    );
                }

                const durationMs = parseDuration(durationStr);
                if (!durationMs) {
                    return interaction.reply(
                        "Invalid duration. Use format like `30d`, `12h`, `45m`.",
                    );
                }

                addPremium(interaction.db, target, durationMs);
                const expiry = getExpiry(interaction.db, target);
                const remaining = expiry - Date.now();

                return interaction.reply({
                    text: `✅ @${target.split("@")[0]} is now premium for *${formatExpiry(durationMs)}*.\nExpires in: *${formatExpiry(remaining)}*.`,
                    mentions: [target],
                });
            }

            case "del":
            case "remove": {
                const target = resolveUserTarget(interaction, value);
                if (!target) {
                    return interaction.reply(
                        "Please mention, reply, or provide a number.",
                    );
                }

                if (!getExpiry(interaction.db, target)) {
                    return interaction.reply("User is not premium.");
                }

                removePremium(interaction.db, target);
                return interaction.reply({
                    text: `✅ Removed premium from @${target.split("@")[0]}.`,
                    mentions: [target],
                });
            }

            case "check": {
                const target =
                    resolveUserTarget(interaction, value) || interaction.user;

                const expiry = getExpiry(interaction.db, target);
                if (!expiry) {
                    return interaction.reply("Not a premium user.");
                }

                const remaining = expiry - Date.now();
                if (remaining <= 0) {
                    removePremium(interaction.db, target);
                    return interaction.reply("Premium expired.");
                }

                return interaction.reply({
                    text: `@${target.split("@")[0]} premium expires in *${formatExpiry(remaining)}*.`,
                    mentions: [target],
                });
            }

            case "list": {
                const users = listPremium(interaction.db);
                if (!users.length) {
                    return interaction.reply("No premium users.");
                }

                const lines = users
                    .sort((a, b) => a.expiry - b.expiry)
                    .map((u, i) => {
                        const remaining = u.expiry - Date.now();
                        return `${i + 1}. @${u.jid.split("@")[0]} - ${formatExpiry(remaining)} left`;
                    });

                return interaction.reply({
                    text: `👑 *Premium Users (${users.length}):*\n\n${lines.join("\n")}`,
                    mentions: users.map((u) => u.jid),
                });
            }

            default:
                return interaction.reply(interaction.usage());
        }
    });
