import { CommandBuilder } from "#libs/structures/CommandBuilder";
import {
    detectMedia,
    getMedia,
    isViewOnce,
    unwrapMessage,
} from "#libs/utils/message";

export default new CommandBuilder()
    .setName("unview")
    .setAliases("vv", "readviewonce")
    .setDescription("Re-send a view-once media you replied to")
    .setUsage("{prefix}{name}")
    .setReact("👁")
    .setHandler(async (interaction) => {
        const quoted = interaction.quoted;
        if (!quoted) {
            return interaction.reply("Reply to a view-once message.");
        }
        if (!isViewOnce(quoted.message)) {
            return;
        }

        const media = detectMedia(unwrapMessage(quoted.message));
        if (!media.type) {
            return interaction.reply("No media in the quoted message.");
        }

        const download = await getMedia(interaction).catch((e) => e);
        if (download instanceof Error) {
            return interaction.reply(download.message);
        }
        if (!download) {
            return interaction.reply("Could not download media.");
        }

        const MEDIA_BUILDERS = {
            image: ({ msg }, buffer) => ({
                image: buffer,
                caption: msg.imageMessage?.caption || "",
            }),
            video: ({ msg }, buffer) => ({
                video: buffer,
                caption: msg.videoMessage?.caption || "",
            }),
            audio: ({ msg }, buffer) => ({
                audio: buffer,
                mimetype: "audio/ogg; codecs=opus",
                ptt: !!msg.audioMessage?.ptt,
            }),
        };

        const build = MEDIA_BUILDERS[media.type];
        if (!build) {
            return interaction.reply("Unsupported media type.");
        }

        return interaction.reply(build(media, download.buffer));
    });
