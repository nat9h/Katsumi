/**
 * @fileoverview Setpp command (owner) — change the bot's profile picture.
 * Accepts an image or document (mime auto-detected by Jimp). Use `--remove`
 * to clear the current picture.
 * @module commands/owner/setpp
 */

import { jidNormalizedUser } from "baileys";
import { Jimp, JimpMime } from "jimp";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("setpp")
    .setAliases("setppbot", "changepp")
    .setDescription("Change the bot's profile picture (full size)")
    .setUsage("{prefix}{name} (send or reply to an image/document) | --remove")
    .setGuard("owner")
    .setRateLimit(30_000, 2)
    .setReact("🖼️")
    .setHandler(async (interaction) => {
        const { flags } = interaction.parseFlags({
            remove: { type: "boolean", short: "r" },
        });

        const botJid = jidNormalizedUser(interaction.sock.user?.id || "");
        if (!botJid) {
            return interaction.reply("Bot JID not available.");
        }

        if (flags.remove) {
            try {
                await interaction.sock.removeProfilePicture(botJid);
                return interaction.reply("✅ Bot picture removed.");
            } catch (err) {
                return interaction.reply(`Failed: ${err.message}`);
            }
        }

        const media = await fetchMedia(interaction, {
            maxBytes: 16 * 1024 * 1024,
        }).catch(() => null);

        if (!media) {
            return interaction.reply(
                "Send or reply to an image (or image document) to set as the bot picture. Use `--remove` to clear it.",
            );
        }

        if (!["image", "document"].includes(media.type)) {
            return interaction.reply(
                "Only images or image documents are supported.",
            );
        }

        const image = await Jimp.read(media.buffer);
        const jpeg = await image.getBuffer(JimpMime.jpeg, { quality: 95 });

        await interaction.sock.updateProfilePicture(botJid, jpeg);
        return interaction.reply(
            `✅ Bot picture updated (${image.width}×${image.height}).`,
        );
    });
