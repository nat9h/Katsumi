/**
 * @fileoverview Pin/Unpin command — pin or unpin a quoted message in a group.
 * @module commands/group/pin
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { findContextInfo } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("pin")
    .setAliases("unpin")
    .setDescription("Pin or unpin a quoted message")
    .setUsage("{prefix}{name} (reply to a message)")
    .setGuard("group", "admin", "botAdmin")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const ctx = findContextInfo(interaction.msg.message);
        if (!ctx?.stanzaId) {
            return interaction.reply(
                "Reply to the message you want to pin/unpin.",
            );
        }

        const isUnpin = interaction.commandName === "unpin";
        const targetKey = {
            remoteJid: interaction.chatJid,
            id: ctx.stanzaId,
            fromMe: false,
            participant: ctx.participant || undefined,
        };

        await interaction.sock.sendMessage(interaction.chatJid, {
            pin: targetKey,
            type: isUnpin ? 2 : 1, // 1 = PIN_FOR_ALL, 2 = UNPIN_FOR_ALL
        });

        await interaction.reply(
            isUnpin ? "📌 Message unpinned." : "📌 Message pinned.",
        );
    });
