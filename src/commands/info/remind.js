/**
 * @fileoverview Remind command — sets a timed reminder for the user.
 * @module commands/info/remind
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { parseDuration } from "#libs/utils/format";

export default new CommandBuilder()
    .setName("remind")
    .setAliases("reminder")
    .setDescription("Set a reminder")
    .setUsage("{prefix}{name} <duration> <message>")
    .setExample("{prefix}{name} 10m beli bensin")
    .setHandler(async (interaction) => {
        const parts = interaction.rawBody.trim().split(/\s+/);
        const dur = parts.shift();
        const text = parts.join(" ").trim();

        if (!dur || !text) {
            return interaction.reply(interaction.usage(interaction.example()));
        }

        const ms = parseDuration(dur);
        if (ms <= 0 || ms > 7 * 86_400_000) {
            return interaction.reply(
                "Invalid duration. Use s/m/h/d, max 7d. Example: `1h30m`.",
            );
        }

        const due = Date.now() + ms;
        const list = interaction.db.get("reminders") || [];
        list.push({
            jid: interaction.chatJid,
            user: interaction.user,
            text,
            due,
        });
        interaction.db.set("reminders", list);

        const human = new Date(due).toLocaleString();
        return interaction.reply(
            `⏰ Reminder set for *${human}*\n_Note:_ ${text}`,
        );
    });
