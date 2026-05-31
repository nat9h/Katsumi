/**
 * @fileoverview Checkmention command — shows who mentioned you and their messages.
 *               Use -c flag to reset mention history.
 * @module commands/info/checkmention
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatTimestamp } from "#libs/utils/format";

export default new CommandBuilder()
    .setName("checkmention")
    .setAliases("cm", "cekmentions", "cekmention", "mentioncheck")
    .setDescription("Check who mentioned you in this group (use -c to clear)")
    .setUsage("{prefix}{name} [-c]")
    .setExample("{prefix}{name}\n{prefix}{name} -c")
    .setGuard("group")
    .setReact("📬")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const key = `mentions:${interaction.chatJid}:${interaction.user}`;
        const mentions = interaction.client.db.get(key) || [];

        const { flags } = interaction.parseFlags({
            clear: { type: "boolean", alias: "c" },
        });

        // Clear mode
        if (flags.clear) {
            if (!mentions.length) {
                return interaction.reply("No mentions to clear.");
            }
            interaction.client.db.delete(key);
            const s = mentions.length > 1 ? "s" : "";
            return interaction.reply(`Cleared ${mentions.length} mention${s}.`);
        }

        if (!mentions.length) {
            return interaction.reply(
                "No one has mentioned you in this group yet.",
            );
        }

        const recent = mentions.slice(-15).reverse();
        const total = mentions.length;
        const s = total > 1 ? "s" : "";

        const lines = [
            `*You've been mentioned ${total} time${s} in this group*\n`,
        ];

        for (const m of recent) {
            const num = m.sender?.split("@")[0] || "unknown";
            const name = m.pushName || num;
            const time = formatTimestamp(m.timestamp);
            const preview = m.text
                ? m.text.length > 80
                    ? `${m.text.slice(0, 80)}…`
                    : m.text
                : "(no text)";

            lines.push(`• *${name}* (@${num})`);
            lines.push(`  ${preview}`);
            lines.push(`  _${time}_\n`);
        }

        if (total > 15) {
            lines.push(
                `_…and ${total - 15} more (only showing 15 most recent)_`,
            );
        }

        lines.push(
            `\nUse *${interaction.prefix}${interaction.commandName} -c* to clear history.`,
        );

        const mentionJids = [
            ...new Set(recent.map((m) => m.sender).filter(Boolean)),
        ];

        return interaction.reply({
            text: lines.join("\n"),
            mentions: mentionJids,
        });
    });
