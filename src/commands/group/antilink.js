/**
 * @fileoverview Antilink command — toggles link deletion in groups.
 * When enabled, non-admin messages containing links are auto-deleted.
 * @module commands/group/antilink
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("antilink")
    .setDescription(
        "Toggle anti-link in this group (deletes links from non-admins)",
    )
    .setUsage("{prefix}{name} <on|off>")
    .setExample("{prefix}antilink on")
    .setGuard("group", "admin")
    .setHandler(async (interaction) => {
        const sub = interaction.rawArgs[0]?.toLowerCase();
        const key = `antilink:${interaction.chatJid}`;
        const current = interaction.db.get(key);

        if (!sub) {
            return interaction.reply(`Anti-link: ${current ? "✅" : "❌"}`);
        }

        if (sub === "on") {
            interaction.db.set(key, true);
            return interaction.reply(
                "✅ Anti-link enabled. Bot must be admin to delete.",
            );
        }

        if (sub === "off") {
            interaction.db.set(key, false);
            return interaction.reply("❌ Anti-link disabled.");
        }

        return interaction.reply(
            `Usage: ${interaction.prefix}${interaction.commandName} on|off`,
        );
    });
