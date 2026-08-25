/**
 * @fileoverview Join command — joins a group via invite link.
 * Owner-only.
 * @module commands/owner/join
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("join")
    .setDescription("Join a group via invite link (owner only)")
    .setUsage("{prefix}{name} <link>")
    .setExample("{prefix}{name} https://chat.whatsapp.com/ABC123")
    .setGuard("owner")
    .addOption("link", "string", "WhatsApp group invite link")
    .setHandler(async (interaction) => {
        const input = interaction.body;
        if (!input) {
            return interaction.reply(interaction.usage());
        }

        const match = input.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
        const code = match?.[1] || input.trim();

        const result = await interaction.sock.groupAcceptInvite(code);
        return interaction.reply(`✅ Joined: ${result}`);
    });
