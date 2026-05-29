import { areJidsSameUser, jidNormalizedUser } from "baileys";
import config from "#config";
import { Interaction } from "#libs/structures/Interaction";
import logger from "#libs/utils/logger";
import { findContextInfo } from "#libs/utils/message";
import { commandMap, customPrefixCommands } from "#libs/utils/plugin";
import { QueueFullError, userQueue } from "#libs/utils/runtime";
import { sendWarmup } from "#libs/utils/warmup";
import { state } from "#state";

const LINK_RE = /https?:\/\/[^\s]+/i;

// key: `${user}:${cmd}` → { count, reset }
const rateLimitStore = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, rec] of rateLimitStore) {
        if (now > rec.reset) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60_000).unref();

/**
 * Permissive owner check used by the command pipeline.
 *
 * Treats fromMe as owner so the bot account can always run commands in
 * self-mode. Strict ownership (for guards) lives in `#utils/permission`.
 *
 * @param {Interaction} interaction
 * @returns {boolean}
 */
export function isOwner(interaction) {
    if (interaction.msg.key.fromMe) {
        return true;
    }

    const { ownerJids, ownerLids } = config;
    const rawJid = interaction.isGroup
        ? interaction.msg.key.participant || ""
        : interaction.msg.key.remoteJid || "";

    let jid = rawJid;
    try {
        jid = jidNormalizedUser(rawJid) || rawJid;
    } catch {}

    for (const owner of ownerJids) {
        if (matchesOwner(jid, rawJid, owner)) {
            return true;
        }
    }
    for (const lid of ownerLids) {
        if (matchesOwner(jid, rawJid, lid)) {
            return true;
        }
    }

    return false;
}

/**
 * @param {string} normJid
 * @param {string} rawJid
 * @param {string} target
 * @returns {boolean}
 */
function matchesOwner(normJid, rawJid, target) {
    if (!target) {
        return false;
    }
    if (normJid === target || rawJid === target) {
        return true;
    }
    try {
        return areJidsSameUser(normJid, target);
    } catch {
        return false;
    }
}

/**
 * @param {object} meta
 * @param {string} jid
 * @returns {object|undefined}
 */
function findParticipant(meta, jid) {
    return meta?.participants?.find((p) => {
        try {
            return areJidsSameUser(p.id, jid);
        } catch {
            return p.id === jid;
        }
    });
}

/**
 * Delete link messages from non-admins when antilink is enabled.
 * Returns true if the message was handled (caller should stop processing).
 *
 * @param {import('../handlers/Client.js').Client} client
 * @param {Interaction} interaction
 * @returns {Promise<boolean>}
 */
async function maybeAntiLink(client, interaction) {
    if (!interaction.isGroup || isOwner(interaction)) {
        return false;
    }
    if (!client.db.get(`antilink:${interaction.chatJid}`)) {
        return false;
    }

    const text = interaction.text;
    if (!text || !LINK_RE.test(text)) {
        return false;
    }

    try {
        const meta = await interaction.getGroupMeta();
        const sender =
            interaction.msg.key.participant || interaction.msg.key.remoteJid;

        if (findParticipant(meta, sender)?.admin) {
            return false;
        }
        if (!findParticipant(meta, interaction.sock.user?.id)?.admin) {
            return false;
        }

        await interaction.sock.sendMessage(interaction.chatJid, {
            delete: {
                remoteJid: interaction.chatJid,
                id: interaction.msgId,
                fromMe: false,
                participant: sender,
            },
        });

        const ephemeral =
            interaction.client.ephemeralCache.get(interaction.chatJid) || 0;
        const opts =
            ephemeral > 0 ? { ephemeralExpiration: ephemeral } : undefined;

        await interaction.sock
            .sendMessage(
                interaction.chatJid,
                {
                    text: `🔗 @${sender.split("@")[0]} links are not allowed in this group.`,
                    mentions: [sender],
                },
                opts,
            )
            .catch(() => {});

        return true;
    } catch (err) {
        logger.warn({ err }, "antilink action failed");
        return false;
    }
}

/**
 * Match the message text against registered commands and return the parsed
 * invocation, or null if nothing matched.
 *
 * Custom-prefix commands (e.g. `>>` for eval) take priority over standard
 * prefix matching.
 *
 * @param {string} text
 * @param {Interaction} interaction
 * @returns {{ cmd: object, name: string, rawArgs: string[], prefix: string }|null}
 */
function parseInvocation(text, interaction) {
    for (const cmd of customPrefixCommands) {
        if (!text.startsWith(cmd.prefix)) {
            continue;
        }
        const body = text.slice(cmd.prefix.length).trim();
        if (!body) {
            continue;
        }
        return {
            cmd,
            name: cmd.name,
            rawArgs: body.split(/\s+/),
            prefix: cmd.prefix,
        };
    }

    let prefix = config.prefixes.find((p) => text.startsWith(p));
    if (prefix === undefined && state.noPrefix && isOwner(interaction)) {
        prefix = "";
    }
    if (prefix === undefined) {
        return null;
    }

    const parts = text.slice(prefix.length).trim().split(/\s+/);
    const name = parts[0]?.toLowerCase();
    if (!name) {
        return null;
    }

    const cmd = commandMap.get(name);
    if (!cmd || cmd.disabled) {
        return null;
    }

    return { cmd, name, rawArgs: parts.slice(1), prefix };
}

/**
 * Return the raw body string after `prefix + name`, preserving internal
 * whitespace (unlike rawArgs.join(" ") which collapses it).
 *
 * @param {string} text
 * @param {string} prefix
 * @param {string} name
 * @returns {string}
 */
function extractRawBody(text, prefix, name) {
    let body = text.slice(prefix.length).replace(/^[ \t]+/, "");
    if (name && body.toLowerCase().startsWith(name.toLowerCase())) {
        body = body.slice(name.length).replace(/^[ \t\r\n]/, "");
    }
    return body;
}

/**
 * Cross-cutting checks that must pass before a command runs.
 * Returns true if the command is allowed to proceed.
 *
 * @param {Interaction} interaction
 * @returns {Promise<boolean>}
 */
async function passesGates(interaction) {
    if (state.selfMode && !interaction.fromMe && !isOwner(interaction)) {
        return false;
    }
    if (!isOwner(interaction) && state.isChatBanned(interaction.chatJid)) {
        return false;
    }
    if (!isOwner(interaction) && state.isUserBanned(interaction.user)) {
        return false;
    }
    if (state.privateOnly && interaction.isGroup && !isOwner(interaction)) {
        return false;
    }

    if (state.adminOnly && !isOwner(interaction)) {
        if (!interaction.isGroup) {
            return false;
        }
        const meta = await interaction.getGroupMeta();
        const user =
            interaction.msg.key.participant || interaction.msg.key.remoteJid;
        if (!findParticipant(meta, user)?.admin) {
            return false;
        }
    }

    return true;
}

/**
 * Returns null if the user is within their rate limit, otherwise returns
 * the cooldown message to send back.
 *
 * @param {Interaction} interaction
 * @param {object} cmd
 * @returns {string|null}
 */
function checkRateLimit(interaction, cmd) {
    if (!cmd.rateLimit || isOwner(interaction)) {
        return null;
    }

    const key = `${interaction.user}:${cmd.name}`;
    const now = Date.now();
    let rec = rateLimitStore.get(key);

    if (!rec || now > rec.reset) {
        rec = { count: 0, reset: now + cmd.rateLimit.window };
        rateLimitStore.set(key, rec);
    }

    if (rec.count >= cmd.rateLimit.max) {
        const retry = Math.ceil((rec.reset - now) / 1000);
        return cmd.cooldownMessage || `⏳ Slow down! Try again in ${retry}s.`;
    }

    rec.count++;
    return null;
}

const isOwnerGuard = (g) => g.name === "owner" || g === "owner";

/**
 * Run all guards attached to the command.
 * Returns null on success, or the rejection message to send.
 *
 * @param {import('../handlers/Client.js').Client} client
 * @param {Interaction} interaction
 * @param {object} cmd
 * @returns {Promise<string|null>}
 */
async function runGuards(client, interaction, cmd) {
    if (!cmd.guards?.length) {
        return null;
    }

    if (client._isClone && cmd.guards.some(isOwnerGuard)) {
        return "🚫 Owner commands are not available on clones.";
    }

    for (const guard of cmd.guards) {
        try {
            await guard(interaction);
        } catch (err) {
            return `🚫 ${err.message}`;
        }
    }
    return null;
}

/**
 * Push the command handler onto the user's serial queue. Commands from
 * the same user run one at a time (FIFO); different users run in
 * parallel. If a user already has too many queued commands, the new one
 * is rejected with a "slow down" reply.
 *
 * Shows a typing indicator after 500ms if the handler hasn't replied
 * yet, and catches any unhandled errors so they don't crash the process.
 *
 * @param {Interaction} interaction
 * @param {object} cmd
 */
function dispatch(interaction, cmd) {
    const userId = interaction.user;
    const wasBusy = userQueue.isBusy(userId);

    const task = async () => {
        const typingTimer = setTimeout(() => {
            if (!interaction._replied) {
                interaction.typing().catch(() => {});
            }
        }, 500);

        try {
            await cmd.handler(interaction);
        } catch (err) {
            logger.error({ err }, `command error: ${cmd.name}`);
            if (!interaction._replied) {
                await interaction
                    .reply(`*${cmd.name}* failed: ${err.message || err}`)
                    .catch(() => {});
            }
        } finally {
            clearTimeout(typingTimer);
            interaction.stopTyping().catch(() => {});
        }
    };

    userQueue.add(userId, task).catch((err) => {
        if (err instanceof QueueFullError) {
            interaction
                .reply("⏳ Too many pending commands. Wait a moment.")
                .catch(() => {});
            return;
        }
        logger.error({ err }, `dispatch error: ${cmd.name}`);
    });

    if (wasBusy) {
        interaction.react("⏳").catch(() => {});
    }
}

/**
 * Track mentions in group messages. Stores up to 50 recent mentions per
 * user per group in the KV store under `mentions:{groupJid}:{targetJid}`.
 *
 * @param {import('../handlers/Client.js').Client} client
 * @param {Interaction} interaction
 */
function trackMentions(client, interaction) {
    if (!interaction.isGroup) {
        return;
    }

    const ctx = interaction.msg.message
        ? findContextInfo(interaction.msg.message)
        : null;
    const mentioned = ctx?.mentionedJid;
    if (!mentioned?.length) {
        return;
    }

    const sender = interaction.user;
    const text = interaction.text || "";
    const timestamp = Date.now();
    const groupJid = interaction.chatJid;

    for (const target of mentioned) {
        if (target === sender) {
            continue;
        }

        const key = `mentions:${groupJid}:${target}`;
        const list = client.db.get(key) || [];

        list.push({
            sender,
            pushName: interaction.userName,
            text: text.slice(0, 200),
            timestamp,
        });

        if (list.length > 50) {
            list.splice(0, list.length - 50);
        }

        client.db.set(key, list);
    }
}

/**
 * Entry point for every incoming message. Parses the command, runs all
 * checks, and dispatches the handler.
 *
 * @param {import('../handlers/Client.js').Client} client
 * @param {object} msg
 */
export async function processMessage(client, msg) {
    const interaction = new Interaction(client, msg);
    const text = interaction.text;
    if (!text) {
        return;
    }

    if (state.autoRead) {
        interaction.sock.readMessages([msg.key]).catch(() => {});
    }

    trackMentions(client, interaction);

    if (await maybeAntiLink(client, interaction)) {
        return;
    }

    const parsed = parseInvocation(text, interaction);
    if (!parsed) {
        return;
    }

    const { cmd, name, rawArgs, prefix } = parsed;
    if (!(await passesGates(interaction))) {
        return;
    }

    interaction.prefix = prefix;
    interaction.commandName = name;
    interaction.rawArgs = rawArgs;
    interaction.body = rawArgs.join(" ");
    interaction.rawBody = extractRawBody(text, prefix, name);
    interaction.autoEphemeral = true;

    if (cmd.options?.length) {
        for (let i = 0; i < cmd.options.length; i++) {
            interaction.args[cmd.options[i].name] = rawArgs[i] ?? null;
        }
    }

    if (cmd.react) {
        interaction.react(cmd.react).catch(() => {});
    }

    const cooldown = checkRateLimit(interaction, cmd);
    if (cooldown) {
        return interaction.reply(cooldown);
    }

    const guardError = await runGuards(client, interaction, cmd);
    if (guardError) {
        return interaction.reply(guardError);
    }

    await sendWarmup(interaction.sock, msg);

    dispatch(interaction, cmd);
}
