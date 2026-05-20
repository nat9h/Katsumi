/**
 * @fileoverview Linkgrup command — fetch the current group invite link.
 * @module commands/group/linkgrup
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("linkgroup")
    .setAliases("linkgrup", "grouplink", "invitelink", "linkgc")
    .setDescription("Get the group invite link")
    .setUsage("{prefix}{name}")
    .setGuard("group", "admin", "botAdmin")
    .setRateLimit(15_000, 2)
    .setHandler(async (interaction) => {
        const code = await interaction.sock.groupInviteCode(
            interaction.chatJid,
        );
        if (!code) {
            return interaction.reply("Could not fetch the group link.");
        }

        const meta = await interaction.getGroupMeta();
        const link = `https://chat.whatsapp.com/${code}`;

        return interaction.reply(`*${meta?.subject || "Group"}*\n${link}`);
    });
