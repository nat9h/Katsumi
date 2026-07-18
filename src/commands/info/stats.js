/**
 * @fileoverview Stats command — displays bot statistics (uptime, messages, memory).
 * @module commands/info/stats
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatBytes, formatUptime } from "#libs/utils/format";

export default new CommandBuilder()
    .setName("stats")
    .setAliases("stat", "info")
    .setDescription("Bot statistics")
    .setUsage("{prefix}{name}")
    .setHandler(async (interaction) => {
        const stats = interaction.client.stats.getGlobal();
        const mem = process.memoryUsage();
        let groups;
        try {
            const participating =
                await interaction.sock.groupFetchAllParticipating();
            groups = Object.keys(participating).length;
        } catch {
            groups = interaction.store.getAllGroups().length;
        }

        return interaction.reply(
            [
                "📊 *Bot Stats*\n",
                `• Uptime: *${formatUptime(process.uptime() * 1000)}*`,
                `• Messages total: *${stats.total.toLocaleString()}*`,
                `• Messages today: *${stats.today.toLocaleString()}*`,
                `• Groups: *${groups}*`,
                `• RSS: *${formatBytes(mem.rss)}*`,
                `• Heap: *${formatBytes(mem.heapUsed)}* / ${formatBytes(mem.heapTotal)}`,
                `• Node: *${process.version}*`,
            ].join("\n"),
        );
    });
