/**
 * @fileoverview Delete command — deletes a quoted message in a group.
 * @module commands/group/delete
 */

import { jidNormalizedUser } from "baileys";
import { CommandBuilder } from "#structures/CommandBuilder";
import { findContextInfo } from "#utils/message";

export default new CommandBuilder()
    .setName("delete")
    .setAliases("del", "d")
    .setDescription("Delete a quoted message")
    .setUsage("{prefix}{name}")
    .setGuard("group")
    .setHandler(async (interaction) => {
        const ctx = findContextInfo(interaction.msg.message);
        if (!ctx?.stanzaId) {
            return interaction.reply(
                "Reply to the message you want to delete.",
            );
        }

        const author = ctx.participant || "";
        const botJid = jidNormalizedUser(interaction.sock.user?.id || "");
        const fromMe = author && jidNormalizedUser(author) === botJid;

        await interaction.sock.sendMessage(interaction.chatJid, {
            delete: {
                remoteJid: interaction.chatJid,
                id: ctx.stanzaId,
                fromMe,
                participant: fromMe ? undefined : author,
            },
        });
    });
