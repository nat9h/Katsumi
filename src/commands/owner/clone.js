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

        const parsePhone = () => {
            const digits = interaction.rawArgs
                .slice(1)
                .join("")
                .replace(/\D/g, "");
            return digits || null;
        };

        switch (sub) {
            case "pair":
            case "create":
            case "start": {
                const target = parsePhone();

                if (!target || target.length < 8) {
                    return interaction.reply(
                        `Usage: \`${interaction.prefix}${interaction.commandName} pair <number>\`\n\n` +
                            `Number must include country code. Examples:\n` +
                            `• \`${interaction.prefix}${interaction.commandName} pair 628123456789\`\n` +
                            `• \`${interaction.prefix}${interaction.commandName} pair +62 812-345-6789\`\n` +
                            `• \`${interaction.prefix}${interaction.commandName} pair +1 (555) 123-4567\``,
                    );
                }

                const jid = `${target}@s.whatsapp.net`;
                const existing = getCloneByOwner(jid);
                if (existing?.active) {
                    return interaction.reply(
                        "This number already has an active clone.\nUse `stop` first to remove it.",
                    );
                }

                try {
                    const [info] =
                        (await interaction.client.sock.onWhatsApp(jid)) ?? [];
                    if (!info?.exists) {
                        return interaction.reply(
                            `*${target}* is not registered on WhatsApp.`,
                        );
                    }
                } catch (err) {
                    return interaction.reply(
                        `Failed to verify number: ${err.message}`,
                    );
                }

                await interaction.reply(
                    "Requesting pairing code, please wait...",
                );

                try {
                    const code = await createClone(jid, interaction.client);
                    await interaction.followUp(
                        `*🔑 Pairing Code:* \`${code}\`\n\n` +
                            `*Steps:*\n` +
                            `1. Open WhatsApp on *${target}*\n` +
                            `2. Go to *Linked Devices*\n` +
                            `3. Tap *Link a Device*\n` +
                            `4. Tap *Link with phone number instead*\n` +
                            `5. Enter the code above\n\n` +
                            `⏰ Code expires in 2 minutes.`,
                    );
                } catch (err) {
                    console.error("[clone command] createClone error:", err);
                    await interaction.followUp(
                        `Failed: ${err.message}\n\nCheck console logs for details.`,
                    );
                }
                return;
            }

            case "stop":
            case "delete":
            case "remove": {
                const arg = interaction.rawArgs[1];

                if (!arg) {
                    return interaction.reply(
                        `Usage:\n` +
                            `• \`${interaction.prefix}${interaction.commandName} stop <number>\`\n` +
                            `• \`${interaction.prefix}${interaction.commandName} stop <index>\` (from \`${interaction.prefix}clone list\`)\n` +
                            `• \`${interaction.prefix}${interaction.commandName} stop all\``,
                    );
                }

                if (arg.toLowerCase() === "all") {
                    const clones = listClones();
                    if (!clones.length) {
                        return interaction.reply("No active clones.");
                    }

                    let stopped = 0;
                    for (const c of clones) {
                        if (deleteCloneByOwner(c.owner)) {
                            stopped++;
                        }
                    }
                    return interaction.reply(
                        `✅ Stopped *${stopped}* clone(s).`,
                    );
                }

                const isShortIndex =
                    interaction.rawArgs.length === 2 && /^\d{1,3}$/.test(arg);
                if (isShortIndex) {
                    const clones = listClones();
                    const idx = Number.parseInt(arg, 10) - 1;
                    if (idx < 0 || idx >= clones.length) {
                        return interaction.reply(
                            `Invalid index. Use \`${interaction.prefix}${interaction.commandName} list\` to see indices.`,
                        );
                    }
                    const target = clones[idx];
                    const removed = deleteCloneByOwner(target.owner);
                    return interaction.reply(
                        removed
                            ? `✅ Clone *${target.jid.split("@")[0]}* (owner: ${target.owner.split("@")[0]}) stopped.`
                            : `Failed to stop clone at index ${idx + 1}.`,
                    );
                }

                const digits = parsePhone();
                if (!digits || digits.length < 8) {
                    return interaction.reply("Invalid phone number.");
                }
                const ownerJid = `${digits}@s.whatsapp.net`;
                const removed = deleteCloneByOwner(ownerJid);
                return interaction.reply(
                    removed
                        ? `✅ Clone for *${digits}* stopped and removed.`
                        : `No clone found for *${digits}*.`,
                );
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
