/**
 * @fileoverview Ping command — measures bot latency and memory usage.
 * @module commands/info/ping
 */

import { CommandBuilder } from "#structures/CommandBuilder";
import { formatBytes } from "#utils/format";

export default new CommandBuilder()
    .setName("ping")
    .setAliases("p")
    .setDescription("Latency & memory usage")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}ping")
    .setReact("🏓")
    .setRateLimit(5000, 2)
    .setCooldownMessage("Woah there! Wait a bit.")
    .setHandler(async (interaction) => {
        const start = Date.now();
        await interaction.reply("Pinging…");
        const latency = Date.now() - start;

        const mem = process.memoryUsage();

        await interaction.editReply(
            `🏓 *${latency}ms*\n` +
                `📦 RSS: ${formatBytes(mem.rss)}\n` +
                `🧠 Heap: ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`,
        );
    });
