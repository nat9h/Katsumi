/**
 * @fileoverview Screenshot command — capture a full page screenshot via thum.io.
 * @module commands/tools/screenshot
 */

import axios from "axios";

import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { extractUrl } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("screenshot")
    .setAliases("ss", "ssweb", "webss")
    .setDescription("Take a full page screenshot of a website")
    .setUsage("{prefix}{name} <url> [--gif]")
    .setExample("{prefix}{name} https://google.com")
    .setNote("Use --gif for animated GIF capture.")
    .setReact("📸")
    .setRateLimit(10_000, 3)
    .setHandler(async (interaction) => {
        const { flags, positional } = interaction.parseFlags({
            gif: { type: "boolean", alias: "g" },
        });

        let url = (
            extractUrl(positional.join(" ")) ||
            positional.join(" ") ||
            interaction.quoted?.url ||
            interaction.quoted?.text ||
            ""
        ).trim();

        if (!url) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <url> [--gif]\``,
            );
        }

        if (!/^https?:\/\//i.test(url)) {
            url = `https://${url}`;
        }

        const opts = flags.gif
            ? "/width/1280/fullpage/animated"
            : "/width/1280/fullpage/noanimate";

        const { data } = await axios.get(
            `https://image.thum.io/get${opts}/${url}`,
            {
                responseType: "arraybuffer",
                timeout: 30_000,
            },
        );

        const buf = Buffer.from(data);

        if (flags.gif) {
            return interaction.reply({
                video: buf,
                gifPlayback: true,
                caption: url,
            });
        }

        return interaction.reply({ image: buf, caption: url });
    });
