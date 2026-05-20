/**
 * @fileoverview Setpp command — change the group's profile picture.
 * Accepts an image or document (mime auto-detected by Jimp).
 * @module commands/group/setpp
 */

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

        const image = await Jimp.read(media.buffer);
        const jpeg = await image.getBuffer(JimpMime.jpeg, { quality: 95 });

        await interaction.sock.updateProfilePicture(interaction.chatJid, jpeg);
        return interaction.reply(
            `✅ Group picture updated (${image.width}×${image.height}).`,
        );
    });
