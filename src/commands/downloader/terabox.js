/**
 * @fileoverview TeraBox command — download files from TeraBox share links.
 * @module commands/downloader/terabox
 */

import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import terabox from "#libs/scrapers/terabox";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("terabox")
    .setAliases("tera", "tb", "teradl")
    .setDescription("Download files from TeraBox share links")
    .setUsage("{prefix}{name} <url>")
    .setExample(
        "{prefix}{name} https://1024terabox.com/s/1LNr3tyl5pI5KUM8BecGtyQ",
    )
    .setReact("☁️")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const url = interaction.urlArg();

        if (!url || !terabox.isValid(url)) {
            return interaction.reply(
                `Provide a valid TeraBox link.\n\nExample: \`${interaction.prefix}${interaction.commandName} https://1024terabox.com/s/1xxx\``,
            );
        }

        await interaction.typing();

        const { files } = await terabox.download(url);
        const file = files[0];

        if (!file?.dlink) {
            return interaction.reply(
                `📄 *${file?.name || "Unknown"}*\n📦 ${file?.size || "?"}\n\nDownload link unavailable.`,
            );
        }

        const caption = `☁️ *TeraBox*\n\n📄 ${file.name}\n📦 ${file.size}`;

        if (file.sizeBytes > 100 * 1024 * 1024) {
            return interaction.reply(
                file.thumbnail
                    ? {
                          image: { url: file.thumbnail },
                          caption: `${caption}\n\nToo large.\n${file.dlink}`,
                      }
                    : `${caption}\n\nToo large.\n${file.dlink}`,
            );
        }

        const { data } = await axios.get(file.dlink, {
            responseType: "arraybuffer",
            timeout: 120_000,
            headers: {
                Cookie: `ndus=${process.env.TERABOX_NDUS}`,
                Referer: "https://www.terabox.com/",
            },
        });

        const buffer = Buffer.from(data);
        const [category] = (
            (await fileTypeFromBuffer(buffer))?.mime ||
            "application/octet-stream"
        ).split("/");

        const msg = { caption };
        if (category === "video") {
            msg.video = buffer;
        } else if (category === "image") {
            msg.image = buffer;
        } else if (category === "audio") {
            Object.assign(msg, {
                audio: buffer,
                mimetype: `${category}/octet-stream`,
            });
        } else {
            Object.assign(msg, { document: buffer, fileName: file.name });
        }

        return interaction.reply(msg);
    });
