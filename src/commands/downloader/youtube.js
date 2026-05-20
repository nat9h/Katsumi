import * as ytdlp from "#libs/services/downloader/yt-dlp";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatDuration } from "#libs/utils/format";
import { selectFromList } from "#libs/utils/interaction";

const FALLBACK_META = {
    title: "YouTube",
    channel: "",
    description: "",
    duration: 0,
    thumbnail: null,
};
const formatResult = (r, i) =>
    `${i + 1}. *${r.title}* - ${r.channel} (${formatDuration(r.duration)})`;

export default new CommandBuilder()
    .setName("youtube")
    .setAliases("yt", "ytdl", "play")
    .setDescription("Search or download YouTube audio/video")
    .setUsage("{prefix}{name} <query|url> [--video | -v]")
    .setExample("{prefix}yt yoasobi idol")
    .setReact("▶️")
    .setRateLimit(15_000, 2)
    .setHandler(async (interaction) => {
        const { flags, positional } = interaction.parseFlags({
            video: { type: "boolean", alias: "v" },
        });
        const wantVideo = flags.video === true;
        const quoted = interaction.quoted?.text || "";

        const query = positional.join(" ").trim() || quoted;

        if (!query) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <query|url> [--video | -v]\``,
            );
        }

        await interaction.typing();

        let url = query;
        let meta;

        if (
            !/^https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\//i.test(
                query,
            )
        ) {
            const results = await ytdlp.search(query, 10);
            if (!results.length) {
                return interaction.reply("No results found.");
            }

            meta = await selectFromList({
                interaction,
                items: results,
                format: formatResult,
                header: {
                    image: results[0].thumbnail
                        ? { url: results[0].thumbnail }
                        : null,
                    caption: "🔍 *YouTube Search*",
                },
            });
            if (!meta) {
                return;
            }
            url = meta.url;
        }

        meta ??= await ytdlp.info(url).catch(() => FALLBACK_META);

        const desc = meta.description
            ? meta.description.length > 150
                ? `${meta.description.slice(0, 150)}...`
                : meta.description
            : "";

        const caption = [
            `▶️ *${meta.title}*`,
            `👤 ${meta.channel || "-"}`,
            `⏱ ${formatDuration(meta.duration)}`,
            ...(desc ? ["", `📝 ${desc}`] : []),
            "",
            "_Downloading..._",
        ].join("\n");

        await interaction.followUp(
            meta.thumbnail
                ? { image: { url: meta.thumbnail }, caption }
                : caption,
        );

        const type = wantVideo ? "video" : "audio";
        try {
            const result = await ytdlp.download(url, type, {
                title: meta.title,
            });
            return interaction.followUp(
                type === "audio"
                    ? {
                          audio: result.buffer,
                          mimetype: result.mimetype,
                          fileName: result.fileName,
                      }
                    : { video: result.buffer, fileName: result.fileName },
            );
        } catch (err) {
            return interaction.followUp(err.message);
        }
    });
