/**
 * @fileoverview Demote command — demote an admin back to member.
 * @module commands/group/demote
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { resolveUserTarget } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("demote")
    .setAliases("deladmin")
    .setDescription("Demote an admin to a regular member")
    .setUsage("{prefix}{name} @user")
    .setExample("{prefix}demote @user")
    .setGuard("group", "admin", "botAdmin")
    .addOption("target", "string", "@mention, reply, or phone number")
    .setHandler(async (interaction) => {
        const target = resolveUserTarget(interaction, interaction.body);

        if (!target) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} @user\` or reply to their message.`,
            );
        }

        const [result] = await interaction.sock.groupParticipantsUpdate(
            interaction.chatJid,
            [target],
            "demote",
        );

        const num = target.split("@")[0];
        if (result?.status && result.status !== "200") {
            return interaction.reply({
                text: `Failed to demote @${num} (status: ${result.status}).`,
                mentions: [target],
            });
        }

        const meta = await interaction.getGroupMeta();
        return interaction.reply({
            text: `✅ Demoted @${num} from admin in ${meta?.subject || "the group"}.`,
            mentions: [target],
        });
    });
