/**
 * @fileoverview Promote command — promote a member to admin.
 * @module commands/group/promote
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { resolveUserTarget } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("promote")
    .setAliases("addadmin")
    .setDescription("Promote a member to admin")
    .setUsage("{prefix}{name} @user")
    .setExample("{prefix}promote @user")
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
            "promote",
        );

        const num = target.split("@")[0];
        if (result?.status && result.status !== "200") {
            return interaction.reply({
                text: `Failed to promote @${num} (status: ${result.status}).`,
                mentions: [target],
            });
        }

        const meta = await interaction.getGroupMeta();
        return interaction.reply({
            text: `✅ Promoted @${num} to admin in ${meta?.subject || "the group"}.`,
            mentions: [target],
        });
    });
