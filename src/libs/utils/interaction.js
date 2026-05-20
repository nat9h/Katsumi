/**
 * @fileoverview Interaction pattern helpers: greeting handler + list selector.
 * @module utils/interaction
 */

import { extractText } from "#libs/utils/message";

/**
 * Shared on/off/set/show handler for welcome and leave commands.
 *
 * @param {object} cfg
 * @param {"welcome"|"leave"} cfg.kind
 * @param {string} cfg.label - Pretty label used in messages (e.g. "Welcome").
 * @param {string} cfg.placeholders - Placeholder hint shown on `set` usage.
 */
export function makeGreetingHandler({ kind, label, placeholders }) {
    return async (interaction) => {
        const sub = interaction.rawArgs[0]?.toLowerCase();
        const rest = interaction.rawArgs.slice(1).join(" ").trim();
        const enabledKey = `${kind}:${interaction.chatJid}:enabled`;
        const tplKey = `${kind}:${interaction.chatJid}`;

        switch (sub) {
            case "on":
                interaction.db.set(enabledKey, true);
                return interaction.reply(`✅ ${label} enabled.`);

            case "off":
                interaction.db.set(enabledKey, false);
                return interaction.reply(`❌ ${label} disabled.`);

            case "set": {
                if (!rest) {
                    return interaction.reply(
                        `Usage: \`${interaction.prefix}${interaction.commandName} set <text>\`\nPlaceholders: ${placeholders}`,
                    );
                }
                interaction.db.set(tplKey, rest);
                return interaction.reply(`✅ ${label} template saved.`);
            }

            case "show":
            case undefined: {
                const enabled = interaction.db.get(enabledKey);
                const tpl = interaction.db.get(tplKey) || "_default template_";
                return interaction.reply(
                    `*${label} status:* ${enabled ? "✅" : "❌"}\n*Template:*\n${tpl}`,
                );
            }

            default:
                return interaction.reply(`Unknown: \`${sub}\``);
        }
    };
}

/**
 * Show a numbered list to the user, wait for them to reply with a number,
 * and resolve to the chosen item (or null on invalid/timeout).
 *
 * @template T
 * @param {object} cfg
 * @param {import('#structures/Interaction.js').Interaction} cfg.interaction
 * @param {T[]} cfg.items
 * @param {(item: T, index: number) => string} cfg.format
 * @param {string|{ caption: string, image?: object|null }} cfg.header
 * @param {number} [cfg.timeout=30_000]
 * @returns {Promise<T|null>}
 */
export async function selectFromList({
    interaction,
    items,
    format,
    header,
    timeout = 30_000,
}) {
    const lines = items.map((item, i) => format(item, i));
    const caption = typeof header === "string" ? header : header.caption;
    const body = `${caption}\n\n${lines.join("\n")}\n\n_Reply number._`;
    const image = typeof header === "object" ? header.image : null;

    await interaction.reply(image ? { image, caption: body } : body);

    try {
        const reply = await interaction.awaitReply(() => true, timeout);
        const num = Number.parseInt(extractText(reply.message).trim(), 10);

        if (!Number.isInteger(num) || num < 1 || num > items.length) {
            await interaction.followUp("Invalid selection.");
            return null;
        }
        return items[num - 1];
    } catch {
        await interaction.followUp("⏰ Timeout.");
        return null;
    }
}
