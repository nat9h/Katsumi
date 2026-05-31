/**
 * @fileoverview Pinterest command — download, search, or visual search (lens).
 * @module commands/downloader/pinterest
 */

import axios from "axios";
import pinterest from "#libs/scrapers/pinterest";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { selectFromList } from "#libs/utils/interaction";
import { fetchMedia } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("pinterest")
    .setAliases("pindl", "pinsearch")
    .setDescription("Download, search, or visual search Pinterest pins")
    .setUsage("{prefix}{name} <url|query|image> [count]")
    .setExample(
        "{prefix}{name} https://pinterest.com/pin/123\n{prefix}pin anime wallpaper\n{prefix}pin anime wallpaper 5\n{prefix}pin (send/reply image)",
    )
    .setNote(
        "URL → download. Text → random pin(s). Image → visual match (lens).",
    )
    .setReact("📌")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const query = (
            interaction.body ||
            interaction.quoted?.url ||
            interaction.quoted?.text ||
            ""
        ).trim();

        await interaction.typing();

        const media = await fetchMedia(interaction).catch(() => null);
        if (media?.type?.startsWith("image")) {
            const results = await pinterest.lens(media.buffer);
            if (!results.length) {
                return interaction.reply("No visual matches found.");
            }

            const selected = await selectFromList({
                interaction,
                items: results,
                format: (item, i) =>
                    `${i + 1}. ${item.title || item.description || "(no title)"} ${item.domain ? `(${item.domain})` : ""}`,
                header: {
                    image: results[0].image ? { url: results[0].image } : null,
                    caption: `🔍 *Pinterest Lens* — ${results.length} matches`,
                },
            });
            if (!selected) {
                return;
            }

            return interaction.followUp({
                image: selected.image ? { url: selected.image } : undefined,
                caption: [selected.title, selected.description, selected.url]
                    .filter(Boolean)
                    .join("\n"),
            });
        }

        if (!query) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <url|query|image>\``,
            );
        }

        if (/(?:pinterest\.com|pin\.it)\//i.test(query)) {
            const result = await pinterest.download(query);
            if (!result.src) {
                return interaction.reply(
                    "Could not extract media. The link may be expired.",
                );
            }

            const caption =
                [
                    result.author ? `👤 *${result.author}*` : "",
                    result.description?.slice(0, 300) || "",
                ]
                    .filter(Boolean)
                    .join("\n") || undefined;

            if (result.type === "video") {
                const { data } = await axios.get(result.src, {
                    responseType: "arraybuffer",
                    timeout: 60_000,
                });
                return interaction.reply({
                    video: Buffer.from(data),
                    caption,
                });
            }
            return interaction.reply({ image: { url: result.src }, caption });
        }

        const parts = query.split(/\s+/);
        const lastPart = parts[parts.length - 1];
        let count = 1;
        let searchQuery = query;

        if (/^\d+$/.test(lastPart) && parts.length > 1) {
            count = Math.min(Number(lastPart), 10);
            searchQuery = parts.slice(0, -1).join(" ");
        }

        const results = await pinterest.search(searchQuery);
        if (!results.length) {
            return interaction.reply(`No pins found for "${searchQuery}".`);
        }

        const picks = results.sort(() => Math.random() - 0.5).slice(0, count);

        const images = picks.filter((p) => p.image && !p.video);
        const videos = picks.filter((p) => p.video);

        if (images.length > 1) {
            const albumItems = images.map((pin) => ({
                url: pin.image,
                type: "image",
            }));
            await interaction.sendAlbum(albumItems, {
                caption: `📌 Pinterest: "${searchQuery}" (${images.length} images)`,
            });
        } else if (images.length === 1) {
            await interaction.reply({
                image: { url: images[0].image },
                caption: images[0].title || undefined,
            });
        }

        for (const [i, pin] of videos.entries()) {
            const { data } = await axios.get(pin.video, {
                responseType: "arraybuffer",
                timeout: 60_000,
            });
            const method =
                images.length === 0 && i === 0 ? "reply" : "followUp";
            await interaction[method]({
                video: Buffer.from(data),
                caption: pin.title || undefined,
            });
        }
    });
