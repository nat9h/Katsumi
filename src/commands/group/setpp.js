/**
 * @fileoverview Setppgc command — change the group's profile picture.
 * Uses a raw `w:profile:picture` IQ so the image keeps its original
 * resolution / quality (Baileys' `updateProfilePicture` downsizes to
 * 640×640 JPEG q=50). The longest side is resized to 720px while
 * preserving aspect ratio.
 * @module commands/group/setpp
 */

import { jidNormalizedUser, S_WHATSAPP_NET } from "baileys";
import { Jimp, JimpMime } from "jimp";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("setppgc")
    .setAliases("changeppgc", "setgrouppp")
    .setDescription("Change the group profile picture (full size)")
    .setUsage("{prefix}{name} (send or reply to an image/document)")
    .setGuard("group", "admin", "botAdmin")
    .setRateLimit(30_000, 2)
    .setReact("🖼️")
    .setHandler(async (interaction) => {
        const media = await fetchMedia(interaction, {
            maxBytes: 16 * 1024 * 1024,
        }).catch(() => null);

        if (!media) {
            return interaction.reply(
                "Send or reply to an image (or image document) to set as the group picture.",
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

        await interaction.sock.query({
            tag: "iq",
            attrs: {
                to: S_WHATSAPP_NET,
                target: jidNormalizedUser(interaction.chatJid),
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

        return interaction.reply(
            "✅ Successfully changed group profile picture.",
        );
    });
