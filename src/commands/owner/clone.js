/**
 * @fileoverview Clone bot management command.
 * @module commands/owner/clone
 */

import {
    createClone,
    deleteCloneByOwner,
    getCloneByOwner,
    listClones,
} from "#libs/services/clone/connect";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("clone")
    .setAliases("jadibot", "clonebot")
    .setDescription("Clone bot management")
    .setUsage("{prefix}{name} <pair|stop|list>")
    .setExample("{prefix}clone pair")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const sub = interaction.rawArgs[0]?.toLowerCase();

        switch (sub) {
            case "pair":
            case "create":
            case "start": {
                const target = interaction.rawArgs[1]
                    ? interaction.rawArgs[1].replace(/[^0-9]/g, "")
                    : null;

                if (!target || target.length < 8) {
                    return interaction.reply(
                        `Usage: \`${interaction.prefix}${interaction.commandName} pair <number>\``,
                    );
                }

                const jid = `${target}@s.whatsapp.net`;
                const existing = getCloneByOwner(jid);
                if (existing?.active) {
                    return interaction.reply(
                        "This number already has an active clone.",
                    );
                }

                await interaction.reply("Requesting pairing code...");

                try {
                    const code = await createClone(jid, interaction.client);
                    await interaction.followUp(
                        `*Pairing Code:* \`${code}\`\n\nOpen WhatsApp on the target phone → Linked Devices → Link a Device → Enter code.`,
                    );
                } catch (err) {
                    await interaction.followUp(err.message);
                }
                return;
            }

            case "stop":
            case "delete":
            case "remove": {
                const target = interaction.rawArgs[1]
                    ? `${interaction.rawArgs[1].replace(/[^0-9]/g, "")}@s.whatsapp.net`
                    : null;

                if (!target) {
                    return interaction.reply(
                        `Usage: \`${interaction.prefix}${interaction.commandName} stop <number>\``,
                    );
                }

                deleteCloneByOwner(target);
                return interaction.reply("Clone removed.");
            }

            case "list": {
                const clones = listClones();
                if (!clones.length) {
                    return interaction.reply("No active clones.");
                }

                const lines = clones.map(
                    (c, i) =>
                        `${i + 1}. ${c.jid.split("@")[0]} (owner: ${c.owner.split("@")[0]})`,
                );
                return interaction.reply(
                    `*Active Clones*\n\n${lines.join("\n")}`,
                );
            }

            default:
                return interaction.reply(
                    `Usage:\n• \`${interaction.prefix}${interaction.commandName} pair <number>\`\n• \`${interaction.prefix}${interaction.commandName} stop <number>\`\n• \`${interaction.prefix}${interaction.commandName} list\``,
                );
        }
    });
