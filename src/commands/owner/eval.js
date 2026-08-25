/**
 * @fileoverview Eval command — evaluates JavaScript code in the bot context.
 * Owner-only. Uses custom prefix ">>".
 * @module commands/owner/eval
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { fmt, sanitizeSecrets } from "#libs/utils/format";

export default new CommandBuilder()
    .setName("eval")
    .setAliases("ev")
    .setPrefix(">>")
    .setDescription("Evaluate JavaScript code")
    .setUsage(">> <code>")
    .setExample(">> sock.user")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const input = interaction.rawBody || interaction.body;
        if (!input) {
            return interaction.reply(interaction.usage());
        }

        try {
            const ctx = {
                i: interaction,
                interaction,
                client: interaction.client,
                sock: interaction.sock,
                db: interaction.db,
                store: interaction.store,
                msg: interaction.msg,
            };

            const hasStatement =
                /\b(return|let|const|var|if|for|while|switch|try|throw)\b/.test(
                    input,
                );
            const code = hasStatement ? input : `return (${input})`;

            const fn = new Function(
                ...Object.keys(ctx),
                `return (async()=>{ ${code} })()`,
            );
            const result = await fn(...Object.values(ctx));

            const text = sanitizeSecrets(fmt(result));
            return interaction.reply(text.trim());
        } catch (err) {
            const text = sanitizeSecrets(err.stack ?? err.message);
            return interaction.reply(text.trim());
        }
    });
