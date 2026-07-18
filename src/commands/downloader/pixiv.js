/**
 * @fileoverview Pixiv command — search artworks and fetch image + metadata.
 * @module commands/downloader/pixiv
 */

import pixiv from "#libs/scrapers/pixiv";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

export default new CommandBuilder()
    .setName("pixiv")
    .setAliases("px", "pxdl")
    .setDescription("Search and download artworks from Pixiv")
    .setUsage("{prefix}{name} <query|url> [count]")
    .setExample(
        "{prefix}{name} nisekoi\n{prefix}{name} anime landscape\n{prefix}{name} chihiro 3\n{prefix}{name} https://www.pixiv.net/en/artworks/147169897",
    )
    .setNote(
        "URL → specific artwork. Text → random artwork(s) with title, author, tags, and link.",
    )
    .setReact("🎨")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const query = (
            interaction.body ||
            interaction.quoted?.url ||
            interaction.quoted?.text ||
            ""
        ).trim();

        if (!query) {
            return interaction.reply(
                `Usage: \`${interaction.prefix}${interaction.commandName} <query|url> [count]\``,
            );
        }

        await interaction.typing();

        const formatCaption = (m) =>
            [
                `*${m.title}*`,
                `by ${m.author.name} (@${m.author.account || m.author.id})`,
                m.tags?.length ? m.tags.slice(0, 8).join(", ") : null,
                m.description ? `\n${m.description.slice(0, 300)}` : null,
                `\n${m.url}`,
                m.aiGenerated ? "AI-generated" : null,
            ]
                .filter(Boolean)
                .join("\n");

        const pixivId = pixiv.extractId(query);
        if (pixivId) {
            const detail = await pixiv.getIllust(pixivId);
            const buffer = await pixiv.fetchImage(
                detail.urls.regular || detail.urls.original,
            );
            return interaction.reply({
                image: buffer,
                caption: formatCaption(detail),
            });
        }

        const parts = query.split(/\s+/);
        const lastPart = parts[parts.length - 1];
        let count = 1;
        let searchQuery = query;

        if (/^\d+$/.test(lastPart) && parts.length > 1) {
            count = Math.min(Number(lastPart), 5);
            searchQuery = parts.slice(0, -1).join(" ");
        }

        const results = await pixiv.search(searchQuery, { limit: 30 });
        if (!results.length) {
            return interaction.reply(`No Pixiv results for "${searchQuery}".`);
        }

        const picks = results.sort(() => Math.random() - 0.5).slice(0, count);

        if (picks.length === 1) {
            const detail = await pixiv.getIllust(picks[0].id);
            const buffer = await pixiv.fetchImage(
                detail.urls.regular || detail.urls.original,
            );
            return interaction.reply({
                image: buffer,
                caption: formatCaption(detail),
            });
        }

        const albumItems = (
            await Promise.all(
                picks.map(async (pick) => {
                    const buffer = await pixiv
                        .fetchImage(pick.thumbnail)
                        .catch(() => null);
                    return buffer
                        ? {
                              buffer,
                              type: "image",
                              caption: formatCaption(pick),
                          }
                        : null;
                }),
            )
        ).filter(Boolean);

        if (!albumItems.length) {
            return interaction.reply("Failed to fetch any images. Try again.");
        }

        return interaction.sendAlbum(albumItems, {
            caption: `Pixiv: "${searchQuery}" (${albumItems.length} artworks)`,
        });
    });
