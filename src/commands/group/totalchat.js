import { CommandBuilder } from "#structures/CommandBuilder";
import { formatTimestamp } from "#utils/format";

const TOP_LIMIT = 20;

export default new CommandBuilder()
    .setName("totalchat")
    .setAliases("tc", "leaderboard", "lb")
    .setDescription("Leaderboard messages in this group.")
    .setUsage("{prefix}{name}")
    .setGuard("group")
    .setHandler(async (interaction) => {
        const raw =
            interaction.client.stats.getGroup(interaction.chatJid) || {};
        const since = raw.__since;
        const counts = Object.fromEntries(
            Object.entries(raw).filter(([k]) => !k.startsWith("__")),
        );

        if (!Object.keys(counts).length) {
            return interaction.reply(
                "There is no chat data in this group yet.",
            );
        }

        const sorted = Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, TOP_LIMIT);

        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const mentions = sorted.map(([jid]) => jid);

        const lines = [`📊 *Total Chat — Top ${sorted.length}*`, ""];
        sorted.forEach(([jid, count], i) => {
            const num = jid.split("@")[0];
            const plural = count > 1 ? "s" : "";
            lines.push(
                `${i + 1}. @${num} (${count.toLocaleString()} chat${plural})`,
            );
        });

        lines.push("", `_Total: ${total.toLocaleString()} messages_`);
        if (since) {
            lines.push(`_Tracked since: ${formatTimestamp(since)}_`);
        }
        lines.push(`_Generated: ${formatTimestamp(Date.now())}_`);

        return interaction.reply({ text: lines.join("\n"), mentions });
    });
