/**
 * @fileoverview Add command — adds members to a group by phone number.
 * Handles privacy-blocked users by sending invite links via DM.
 * @module commands/group/add
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("add")
    .setDescription("Add a member to the group")
    .setUsage("{prefix}{name} <number>")
    .setExample("{prefix}add 628123456789")
    .setGuard("group", "admin", "botAdmin")
    .addOption("number", "string", "phone number(s) to add")
    .setHandler(async (interaction) => {
        const input = interaction.body;
        if (!input) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <number>\`\nSeparate multiple with comma or space.`,
            );
        }

        const raw = input
            .split(/[,\s]+/)
            .map((n) => n.replace(/[^0-9]/g, ""))
            .filter((n) => n.length >= 8);

        if (!raw.length) {
            return interaction.reply(
                "Provide at least one valid phone number.",
            );
        }

        const checked = await interaction.sock.onWhatsApp(...raw);
        const valid = checked.filter((c) => c.exists).map((c) => c.jid);
        const invalid = raw.filter(
            (n) => !checked.some((c) => c.exists && c.jid.startsWith(n)),
        );

        const lines = [];
        if (invalid.length) {
            lines.push(`Not on WhatsApp: ${invalid.join(", ")}`);
        }
        if (!valid.length) {
            if (lines.length) {
                return interaction.reply(lines.join("\n"));
            }
            return interaction.reply("No valid WhatsApp numbers found.");
        }

        try {
            const result = await interaction.sock.groupParticipantsUpdate(
                interaction.chatJid,
                valid,
                "add",
            );

            const privacyBlocked = [];

            for (const r of result) {
                const jid = r.jid || "";
                const num = jid.split("@")[0] || "?";

                if (r.status === "200") {
                    lines.push(`@${num} added`);
                } else if (r.status === "403") {
                    lines.push(`@${num} — privacy enabled, sending invite...`);
                    privacyBlocked.push(jid);
                } else if (r.status === "408") {
                    lines.push(`@${num} — recently left, can't add yet`);
                } else if (r.status === "409") {
                    lines.push(`@${num} — already in group`);
                } else {
                    lines.push(`@${num} — failed (${r.status})`);
                }
            }

            if (privacyBlocked.length) {
                try {
                    const code = await interaction.sock.groupInviteCode(
                        interaction.chatJid,
                    );
                    const link = `https://chat.whatsapp.com/${code}`;
                    const meta = await interaction.getGroupMeta();
                    const groupName = meta?.subject || "a group";

                    for (const jid of privacyBlocked) {
                        const exp =
                            interaction.client.ephemeralCache.get(jid) || 0;
                        await interaction.sock.sendMessage(
                            jid,
                            {
                                text: `You've been invited to join *${groupName}*\n\n${link}`,
                            },
                            exp > 0 ? { ephemeralExpiration: exp } : undefined,
                        );
                    }
                    lines.push(
                        `\nInvite sent to ${privacyBlocked.length} user(s) via DM.`,
                    );
                } catch (err) {
                    lines.push(`\nCould not send invite: ${err.message}`);
                }
            }

            return interaction.reply({
                text: lines.join("\n").trim(),
                mentions: valid,
            });
        } catch (err) {
            return interaction.reply(`Failed: ${err.message}`);
        }
    });
