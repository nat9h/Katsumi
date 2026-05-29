/**
 * @fileoverview Set command — manages bot settings (toggles, bans).
 * Owner-only.
 * @module commands/owner/set
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { statusIcon } from "#libs/utils/format";
import { resolveUserTarget } from "#libs/utils/message";
import { state } from "#state";

/**
 * Toggle definitions mapping subcommand names to state getters/setters.
 * @type {Record<string, { get: () => boolean, set: (v: boolean) => void, label: string }>}
 */
const TOGGLES = {
    self: {
        get: () => state.selfMode,
        set: (v) => state.setSelfMode(v),
        label: "Self mode",
    },
    admin: {
        get: () => state.adminOnly,
        set: (v) => state.setAdminOnly(v),
        label: "Admin only",
    },
    private: {
        get: () => state.privateOnly,
        set: (v) => state.setPrivateOnly(v),
        label: "Private only",
    },
    pc: {
        get: () => state.privateOnly,
        set: (v) => state.setPrivateOnly(v),
        label: "Private only",
    },
    anticall: {
        get: () => state.antiCall,
        set: (v) => state.setAntiCall(v),
        label: "Anti-call",
    },
    autoread: {
        get: () => state.autoRead,
        set: (v) => state.setAutoRead(v),
        label: "Auto-read",
    },
    warmup: {
        get: () => state.warmup,
        set: (v) => state.setWarmup(v),
        label: "Warmup",
    },
};

export default new CommandBuilder()
    .setName("set")
    .setAliases("setting", "settings")
    .setDescription("Bot settings (owner only)")
    .setUsage(
        "{prefix}{name} <self|admin|private|anticall|autoread|warmup|ban|unban|banlist>",
    )
    .setExample("{prefix}set self on")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const { prefix: p, commandName: cmd, rawArgs: parts } = interaction;
        const action = parts[0]?.toLowerCase();
        const value = parts.slice(1).join(" ");

        if (!action) {
            return interaction.reply(
                [
                    "⚙️ *Bot Settings*\n",
                    `• Self mode: *${statusIcon(state.selfMode)}*`,
                    `• Admin only: *${statusIcon(state.adminOnly)}*`,
                    `• Private only: *${statusIcon(state.privateOnly)}*`,
                    `• Anti-call: *${statusIcon(state.antiCall)}*`,
                    `• Auto-read: *${statusIcon(state.autoRead)}*`,
                    `• Warmup: *${statusIcon(state.warmup)}*`,
                    `• Banned chats: *${state.getBannedChats().length}*`,
                    `• Banned users: *${state.getBannedUsers().length}*`,
                ].join("\n"),
            );
        }

        if (TOGGLES[action]) {
            const t = TOGGLES[action];
            const v = value?.toLowerCase();
            if (v !== "on" && v !== "off") {
                return interaction.reply(
                    `${t.label}: *${statusIcon(t.get())}*\nUsage: \`${p}${cmd} ${action} on|off\``,
                );
            }
            t.set(v === "on");
            return interaction.reply(`${t.label}: *${statusIcon(t.get())}*`);
        }

        switch (action) {
            case "ban": {
                const userTarget = resolveUserTarget(interaction, value);
                if (userTarget) {
                    if (state.isUserBanned(userTarget)) {
                        return interaction.reply("User already banned.");
                    }
                    state.banUser(userTarget);
                    return interaction.reply({
                        text: `🚫 Banned: @${userTarget.split("@")[0]}`,
                        mentions: [userTarget],
                    });
                }

                if (interaction.isGroup) {
                    const jid = interaction.chatJid;
                    if (state.isChatBanned(jid)) {
                        return interaction.reply("Already banned.");
                    }
                    state.banChat(jid);
                    return interaction.reply("🚫 This group is now *banned*.");
                }

                const groups = interaction.store
                    .getAllGroups()
                    .filter((g) => !state.isChatBanned(g.id));
                if (!groups.length) {
                    return interaction.reply("No groups available to ban.");
                }

                const picked = await interaction.pickFromList(
                    groups,
                    "Select group to ban",
                );
                if (!picked) {
                    return;
                }
                state.banChat(picked.id);
                return interaction.followUp(
                    `🚫 Banned: *${picked.subject || picked.id}*`,
                );
            }

            case "unban": {
                const userTarget = resolveUserTarget(interaction, value);
                if (userTarget) {
                    if (!state.isUserBanned(userTarget)) {
                        return interaction.reply("User is not banned.");
                    }
                    state.unbanUser(userTarget);
                    return interaction.reply({
                        text: `✅ Unbanned: @${userTarget.split("@")[0]}`,
                        mentions: [userTarget],
                    });
                }

                if (interaction.isGroup) {
                    const jid = interaction.chatJid;
                    if (!state.isChatBanned(jid)) {
                        return interaction.reply("Not banned.");
                    }
                    state.unbanChat(jid);
                    return interaction.reply(
                        "✅ This group is now *unbanned*.",
                    );
                }

                const banned = state.getBannedChats();
                if (!banned.length) {
                    return interaction.reply("No banned chats.");
                }

                const allGroups = interaction.store.getAllGroups();
                const items = banned.map(
                    (jid) =>
                        allGroups.find((g) => g.id === jid) || {
                            id: jid,
                            subject: jid,
                        },
                );

                const picked = await interaction.pickFromList(
                    items,
                    "Select group to unban",
                );
                if (!picked) {
                    return;
                }
                state.unbanChat(picked.id);
                return interaction.followUp(
                    `✅ Unbanned: *${picked.subject || picked.id}*`,
                );
            }

            case "banlist":
            case "list": {
                const chats = state.getBannedChats();
                const users = state.getBannedUsers();

                if (!chats.length && !users.length) {
                    return interaction.reply("No bans.");
                }

                const groups = interaction.store.getAllGroups();
                const lines = [];

                if (chats.length) {
                    lines.push(`*Banned chats (${chats.length}):*`);
                    chats.forEach((jid, i) => {
                        const g = groups.find((x) => x.id === jid);
                        lines.push(`${i + 1}. ${g?.subject || jid}`);
                    });
                }

                if (users.length) {
                    if (lines.length) {
                        lines.push("");
                    }
                    lines.push(`*Banned users (${users.length}):*`);
                    users.forEach((jid, i) =>
                        lines.push(`${i + 1}. @${jid.split("@")[0]}`),
                    );
                }

                return interaction.reply({
                    text: lines.join("\n"),
                    mentions: users,
                });
            }

            default:
                return interaction.reply(
                    `Unknown: *${action}*\n\nAvailable: \`self\`, \`admin\`, \`private\`, \`anticall\`, \`autoread\`, \`warmup\`, \`ban\`, \`unban\`, \`banlist\``,
                );
        }
    });
