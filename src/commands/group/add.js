/**
 * @fileoverview Add command — adds members to a group by phone number.
 * @module commands/group/add
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import {
    buildGroupInviteMessage,
    extractInviteAttrs,
    fetchGroupThumbnail,
} from "#libs/utils/group";

export default new CommandBuilder()
    .setName("add")
    .setAliases("+")
    .setDescription("Add a member to the group")
    .setUsage("{prefix}{name} <number>[, <number>, ...]")
    .setExample("{prefix}{name} 628123456789")
    .setGuard("group", "admin", "botAdmin")
    .addOption("number", "string", "phone number(s) to add")
    .setHandler(async (interaction) => {
        const { sock, chatJid, client } = interaction;
        const input = interaction.body;

        if (!input) {
            return interaction.reply(
                interaction.usage("Separate multiple numbers with commas."),
            );
        }

        const digitsList = [
            ...new Set(
                input
                    .split(",")
                    .map((c) => c.replace(/[^0-9]/g, ""))
                    .filter((d) => d.length >= 8 && d.length <= 17),
            ),
        ];

        if (!digitsList.length) {
            return interaction.reply(
                "Provide at least one valid phone number.",
            );
        }

        const checked = (await sock.onWhatsApp(...digitsList)) || [];
        /** @type {Array<{ digits: string, pn: string }>} */
        const users = [];
        const invalid = [];

        for (let i = 0; i < digitsList.length; i++) {
            const digits = digitsList[i];
            if (checked[i]?.exists) {
                users.push({ digits, pn: `${digits}@s.whatsapp.net` });
            } else {
                invalid.push(digits);
            }
        }

        const lines = [];
        if (invalid.length) {
            lines.push(`Not on WhatsApp: ${invalid.join(", ")}`);
        }
        if (!users.length) {
            return interaction.reply(
                lines.length
                    ? lines.join("\n")
                    : "No valid WhatsApp numbers found.",
            );
        }

        const mentions = users.map((u) => u.pn);

        try {
            const result = await sock.groupParticipantsUpdate(
                chatJid,
                mentions,
                "add",
            );

            const inviteV4 = [];
            const linkFallback = [];

            for (let i = 0; i < result.length; i++) {
                const r = result[i];
                const user = users[i];
                const tag = user ? `@${user.digits}` : "@?";

                switch (r.status) {
                    case "200":
                        lines.push(`${tag} added`);
                        break;
                    case "403": {
                        const attrs = extractInviteAttrs(r.content);
                        if (attrs && user) {
                            inviteV4.push({ user, ...attrs });
                            lines.push(`${tag} — privacy on, invite sent`);
                        } else if (user) {
                            linkFallback.push(user);
                            lines.push(
                                `${tag} — privacy on, falling back to link`,
                            );
                        } else {
                            lines.push(`${tag} — privacy on (unmatched)`);
                        }
                        break;
                    }
                    case "408":
                        if (user) {
                            linkFallback.push(user);
                        }
                        lines.push(
                            `${tag} — recently left, sending invite link`,
                        );
                        break;
                    case "409":
                        lines.push(`${tag} — already in group`);
                        break;
                    case "421":
                        lines.push(
                            `${tag} — ${r.content?.content?.[0]?.tag || "blocked by WhatsApp"}`,
                        );
                        break;
                    default:
                        lines.push(`${tag} — failed (${r.status})`);
                }
            }

            if (inviteV4.length) {
                const meta = await interaction.getGroupMeta();
                const groupName = meta?.subject || "a group";
                const thumbnail = await fetchGroupThumbnail(sock, chatJid);

                for (const { user, code, expiration } of inviteV4) {
                    try {
                        const inviteMsg = await buildGroupInviteMessage({
                            sock,
                            groupJid: chatJid,
                            targetJid: user.pn,
                            code,
                            expiration,
                            groupName,
                            thumbnail,
                        });

                        const exp = client.ephemeralCache.get(user.pn) || 0;
                        await sock.sendMessage(
                            user.pn,
                            { forward: inviteMsg },
                            exp > 0 ? { ephemeralExpiration: exp } : undefined,
                        );
                    } catch (err) {
                        lines.push(
                            `\nInvite to @${user.digits} failed: ${err.message}`,
                        );
                    }
                }
            }

            if (linkFallback.length) {
                try {
                    const code = await sock.groupInviteCode(chatJid);
                    const link = `https://chat.whatsapp.com/${code}`;
                    const meta = await interaction.getGroupMeta();
                    const groupName = meta?.subject || "a group";

                    for (const user of linkFallback) {
                        const exp = client.ephemeralCache.get(user.pn) || 0;
                        await sock.sendMessage(
                            user.pn,
                            {
                                text: `You've been invited to join *${groupName}*\n\n${link}`,
                            },
                            exp > 0 ? { ephemeralExpiration: exp } : undefined,
                        );
                    }
                } catch (err) {
                    lines.push(`\nCould not send invite link: ${err.message}`);
                }
            }

            return interaction.reply({
                text: lines.join("\n").trim(),
                mentions,
            });
        } catch (err) {
            return interaction.reply(`Failed: ${err.message}`);
        }
    });
