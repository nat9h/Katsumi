/**
 * Shared on/off/set/show handler for welcome and leave commands.
 * Both store under `${kind}:${jid}:enabled` flag and `${kind}:${jid}` template.
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
