/**
 * @fileoverview Text-to-image generation using NanoBanana AI.
 * Supports per-user persistent model/resolution preferences.
 * @module commands/ai/imagine
 */

import { NanoBanana } from "#libs/scrapers/nanobanana";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

const _models = Object.keys(NanoBanana.models);
const _res = ["1K", "2K", "4K"];

export default new CommandBuilder()
    .setName("imagine")
    .setAliases("imagine", "img", "generate", "txt2img")
    .setDescription("Generate images from text using NanoBanana AI")
    .setUsage("{prefix}{name} <prompt | set model|res <value> | config>")
    .setExample(
        "{prefix}{name} a cute cat\n{prefix}{name} set model nano-banana-pro\n{prefix}{name} set res 2K\n{prefix}{name} config",
    )
    .setNote(`Models: ${_models.join(", ")}. Resolutions: ${_res.join(", ")}.`)
    .setReact("🎨")
    .setRateLimit(30_000, 1)
    .setHandler(async (interaction) => {
        const { positional } = interaction.parseFlags({});
        const sub = positional[0]?.toLowerCase();

        const DB_KEY = (user) => `imagine:prefs:${user.split("@")[0]}`;

        const prefs = interaction.db.get(DB_KEY(interaction.user)) || {
            model: "nano-banana",
            resolution: "1K",
        };

        if (sub === "config" || sub === "settings") {
            return interaction.reply(
                [
                    "*Image Generation Config*\n",
                    `Model: *${prefs.model}*`,
                    `Resolution: *${prefs.resolution}*\n`,
                    `Available models: ${_models.join(", ")}`,
                    `Available resolutions: ${_res.join(", ")}`,
                ].join("\n"),
            );
        }

        if (sub === "set") {
            const key = positional[1]?.toLowerCase();
            const value = positional.slice(2).join(" ").trim();

            if (key === "model" || key === "m") {
                if (!value || !_models.includes(value)) {
                    return interaction.reply(
                        `Invalid model. Available: ${_models.join(", ")}`,
                    );
                }
                prefs.model = value;
                interaction.db.set(DB_KEY(interaction.user), prefs);
                return interaction.reply(`Model set to *${value}*.`);
            }

            if (key === "res" || key === "resolution" || key === "r") {
                const res = value?.toUpperCase();
                if (!res || !_res.includes(res)) {
                    return interaction.reply(
                        `Invalid resolution. Available: ${_res.join(", ")}`,
                    );
                }
                prefs.resolution = res;
                interaction.db.set(DB_KEY(interaction.user), prefs);
                return interaction.reply(`Resolution set to *${res}*.`);
            }

            return interaction.reply(
                [
                    "*Usage:*",
                    `\`${interaction.prefix}${interaction.commandName} set model <name>\``,
                    `\`${interaction.prefix}${interaction.commandName} set res <1K|2K|4K>\``,
                ].join("\n"),
            );
        }

        const prompt =
            positional.join(" ").trim() || interaction.quoted?.text?.trim();

        if (!prompt) {
            return interaction.reply(
                [
                    "*NanoBanana Text-to-Image*\n",
                    "*Usage:*",
                    `\`${interaction.prefix}${interaction.commandName} <prompt>\``,
                    `\`${interaction.prefix}${interaction.commandName} set model <name>\``,
                    `\`${interaction.prefix}${interaction.commandName} set res <1K|2K|4K>\``,
                    `\`${interaction.prefix}${interaction.commandName} config\`\n`,
                    `*Models:* ${_models.join(", ")}`,
                    `*Resolutions:* ${_res.join(", ")}`,
                ].join("\n"),
            );
        }

        const nano = new NanoBanana();
        const result = await nano.process(null, prompt, {
            model: prefs.model,
            resolution: prefs.resolution,
        });

        return interaction.reply({
            image: result.buffer,
            caption: `*${prompt}*\n\n${prefs.resolution} | ${prefs.model}`,
        });
    });
