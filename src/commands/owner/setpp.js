/**
 * @fileoverview Setpp command (owner) — change the bot's profile picture.
 * Uses a raw `w:profile:picture` IQ so the image keeps its original
 * resolution / quality (Baileys' `updateProfilePicture` downsizes to
 * 640×640 JPEG q=50). The longest side is resized to 720px while
 * preserving aspect ratio. Use `--remove` to clear the current picture.
 * @module commands/owner/setpp
 */

import { jidNormalizedUser, S_WHATSAPP_NET } from "baileys";
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

        const { sock } = interaction;
        const botJid = jidNormalizedUser(sock.user?.id || "");
        if (!botJid) {
            return interaction.reply("Bot JID not available.");
        }

        if (flags.remove) {
            try {
                await sock.removeProfilePicture(botJid);
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

        async function pp() {
            const image = await Jimp.read(media.buffer);
            let resized;
            if (image.width > image.height) {
                resized = image.resize({ w: 720, h: Jimp.RESIZE_AUTO });
            } else {
                resized = image.resize({ w: Jimp.RESIZE_AUTO, h: 720 });
            }
            return {
                img: await resized.getBuffer(JimpMime.jpeg),
            };
        }

        const { img } = await pp();
        if (!img) {
            return interaction.reply("Failed.");
        }

        await sock.query({
            tag: "iq",
            attrs: {
                to: S_WHATSAPP_NET,
                type: "set",
                xmlns: "w:profile:picture",
            },
            content: [
                {
                    tag: "picture",
                    attrs: { type: "image" },
                    content: img,
                },
            ],
        });

        return interaction.reply("✅ Successfully changed profile picture.");
    });
