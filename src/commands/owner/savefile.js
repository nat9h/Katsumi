/**
 * @fileoverview SaveFile command — saves replied text/document to a file path.
 * @module commands/owner/savefile
 */

import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { downloadMediaMessage } from "baileys";
import { CommandBuilder } from "#structures/CommandBuilder";
import { extractText } from "#utils/message";

export default new CommandBuilder()
    .setName("savefile")
    .setAliases("sf", "save")
    .setDescription("Save replied text or document to a file")
    .setUsage("{prefix}{name} <path>")
    .setExample("{prefix}sf src/commands/tools/test.js")
    .setNote("Reply to a text message or document file.")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const targetPath = interaction.body;
        if (!targetPath) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <path>\`\nReply to text or document.`,
            );
        }

        const quoted = interaction.quoted;
        if (!quoted) {
            return interaction.reply(
                "Reply to a text message or document file.",
            );
        }

        let content;
        const docMsg = quoted.message?.documentMessage;

        if (docMsg) {
            content = await downloadMediaMessage(
                {
                    key: {
                        remoteJid: interaction.chatJid,
                        id: quoted.stanzaId,
                        participant: quoted.sender,
                    },
                    message: quoted.message,
                },
                "buffer",
                {},
            );
        } else {
            const text = extractText(quoted.message);
            if (!text?.trim()) {
                return interaction.reply("Quoted message has no content.");
            }
            content = text;
        }

        const filePath = join(process.cwd(), targetPath);
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        await writeFile(filePath, content);
        return interaction.reply(`✅ Saved to \`${targetPath}\``);
    });
