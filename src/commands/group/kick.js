/**
 * @fileoverview Kick command — removes a member from the group.
 * @module commands/group/kick
 */

import { CommandBuilder } from "#structures/CommandBuilder";
import { findContextInfo } from "#utils/message";

export default new CommandBuilder()
    .setName("kick")
    .setAliases("remove")
    .setDescription("Kick a member from the group")
    .setUsage("{prefix}{name} @user")
    .setExample("{prefix}kick @user")
    .setGuard("group", "admin", "botAdmin")
    .addOption("target", "string", "@mention or reply")
    .setHandler(async (interaction) => {
        const ctx = findContextInfo(interaction.msg.message);
        const target = ctx?.mentionedJid?.[0] || ctx?.participant;

        if (!target) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} @user\` or reply to their message.`,
            );
        }

        try {
            await interaction.sock.groupParticipantsUpdate(
                interaction.chatJid,
                [target],
                "remove",
            );
            return interaction.reply({
                text: `✅ Kicked: @${target.split("@")[0]}`,
                mentions: [target],
            });
        } catch (err) {
            return interaction.reply(`Failed: ${err.message}`);
        }
    });
