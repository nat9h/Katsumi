/**
 * @fileoverview Out command — leaves a group (current or selected from list).
 * Owner-only.
 * @module commands/owner/out
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("out")
    .setAliases("groupleave", "leavegroup")
    .setDescription("Leave a group (owner only)")
    .setUsage("{prefix}{name}")
    .setExample("{prefix}out")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        if (interaction.isGroup) {
            await interaction.reply("👋 Leaving...");
            await interaction.sock.groupLeave(interaction.chatJid);
            interaction.store.deleteGroup(interaction.chatJid);
            interaction.client.groupCache.delete(interaction.chatJid);
            return;
        }

        const groups = interaction.store.getAllGroups();
        if (!groups.length) {
            return interaction.reply("No groups in store.");
        }

        const picked = await interaction.pickFromList(
            groups,
            "Select group to leave",
        );
        if (!picked) {
            return;
        }

        await interaction.sock.groupLeave(picked.id);
        interaction.store.deleteGroup(picked.id);
        interaction.client.groupCache.delete(picked.id);
        await interaction.followUp(`✅ Left: *${picked.subject || picked.id}*`);
    });
