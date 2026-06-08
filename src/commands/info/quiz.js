/**
 * @fileoverview Quiz command — send an interactive quiz poll using the new
 * pollCreationMessageV5 + PollType.QUIZ proto with a correct-answer field.
 *
 * Syntax:
 *   {prefix}{name} <question> | <opt1> | <opt2> | ... | answer:<index|text>
 * The answer marker can be:
 *   - "answer:2"   → option index 2 (1-based) is correct
 *   - "answer:Yes" → option whose text matches "Yes" is correct
 *   - "*Yes"       → prefix any option with "*" to mark it correct inline
 *
 * @module commands/info/quiz
 */

import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("quiz")
    .setAliases("kuis")
    .setDescription("Interactive quiz poll with a correct answer")
    .setUsage("{prefix}{name} <question> | <opt1> | <opt2> | ... | answer:<n>")
    .setExample("{prefix}{name} Capital of Japan? | Tokyo | Osaka | answer:1")
    .setReact("🧠")
    .setRateLimit(15_000, 3)
    .setHandler(async (interaction) => {
        const MIN_OPTIONS = 2;
        const MAX_OPTIONS = 12;

        const help = () =>
            [
                `*Quiz syntax*`,
                `\`${interaction.prefix}${interaction.commandName} <question> | <opt1> | <opt2> | ... | answer:<n|text>\``,
                ``,
                `Or mark the correct option inline with *:`,
                `\`${interaction.prefix}${interaction.commandName} 2+2? | 3 | *4 | 5\``,
                ``,
                `Examples:`,
                `• \`${interaction.prefix}${interaction.commandName} Capital of Japan? | Tokyo | Osaka | Kyoto | answer:1\``,
                `• \`${interaction.prefix}${interaction.commandName} Bot ini namanya? | Katsumi | Naruto | answer:Katsumi\``,
                `• \`${interaction.prefix}${interaction.commandName} Pick the prime | 4 | *7 | 9\``,
            ].join("\n");

        const body = interaction.rawBody?.trim();
        if (!body) {
            return interaction.reply(help());
        }

        const parts = body
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean);

        if (parts.length < 1 + MIN_OPTIONS) {
            return interaction.reply(
                `Need at least 1 question and ${MIN_OPTIONS} options separated by " | ".\n\n${help()}`,
            );
        }

        const question = parts.shift();

        let answerIndex = -1;
        const answerToken = parts[parts.length - 1];
        const answerMatch = /^answer\s*[:=]\s*(.+)$/i.exec(answerToken || "");
        if (answerMatch) {
            parts.pop();
            const value = answerMatch[1].trim();
            const asNum = Number.parseInt(value, 10);
            if (
                Number.isInteger(asNum) &&
                asNum >= 1 &&
                asNum <= parts.length
            ) {
                answerIndex = asNum - 1;
            } else {
                answerIndex = parts.findIndex(
                    (o) =>
                        o.replace(/^\*\s*/, "").toLowerCase() ===
                        value.toLowerCase(),
                );
            }
        }

        const options = parts.map((opt, i) => {
            if (opt.startsWith("*") && answerIndex < 0) {
                answerIndex = i;
                return opt.slice(1).trim();
            }
            return opt.replace(/^\*\s*/, "");
        });

        if (options.length < MIN_OPTIONS) {
            return interaction.reply(`Need at least ${MIN_OPTIONS} options.`);
        }
        if (options.length > MAX_OPTIONS) {
            return interaction.reply(`Maximum ${MAX_OPTIONS} options allowed.`);
        }
        if (answerIndex < 0) {
            return interaction.reply(
                "Mark the correct answer with `answer:<n>`, `answer:<text>`, or prefix the right option with `*`.",
            );
        }

        await interaction.sendQuiz(question, options, answerIndex);
    });
