/**
 * @fileoverview MediaFire command — download files from MediaFire links.
 * @module commands/downloader/mediafire
 */

import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import { Mediafire } from "#libs/scrapers/mediafire";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("mediafire")
    .setAliases("mf", "mfire", "mfdl")
    .setDescription("Download files from MediaFire links")
    .setUsage("{prefix}{name} <url>")
    .setExample("{prefix}{name} https://www.mediafire.com/file/xxx/file.apk")
    .setReact("📥")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const url = interaction.urlArg();

        if (!url || !/mediafire\.com/i.test(url)) {
            return interaction.reply(
                `Provide a valid MediaFire link.\n\nExample: \`${interaction.prefix}${interaction.commandName} https://www.mediafire.com/file/xxx\``,
            );
        }

        await interaction.typing();

        const result = await Mediafire.download(url);

        const caption = [
            `*MediaFire Download*`,
            "",
            `📄 ${result.name}`,
            `📦 ${result.size}`,
            `📎 ${result.type}`,
        ].join("\n");

        const { data } = await axios.get(result.download, {
            responseType: "arraybuffer",
            timeout: 120_000,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        });

        const buffer = Buffer.from(data);
        const [category] = (
            (await fileTypeFromBuffer(buffer))?.mime ||
            "application/octet-stream"
        ).split("/");

        const variants = {
            video: { video: buffer },
            image: { image: buffer },
            audio: { audio: buffer, mimetype: "audio/mpeg" },
        };

        return interaction.reply({
            caption,
            ...(variants[category] ?? {
                document: buffer,
                fileName: result.filename || result.name,
            }),
        });
    });
