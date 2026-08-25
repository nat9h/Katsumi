/**
 * @fileoverview Booru command — random anime image by tags across 7 sites.
 * @module commands/tools/booru
 */

import axios from "axios";
import { Booru, getBooru } from "#libs/scrapers/booru";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

const sites = Object.keys(Booru.sites);
const siteSet = new Set(sites);
const siteList = sites.map((s, i) => `${i + 1}. ${s}`).join("\n");

export default new CommandBuilder()
    .setName("booru")
    .setAliases(...sites)
    .setDescription("Random anime image by tags")
    .setUsage("{prefix}{name} <tags>  |  {prefix}{name} <site> <tags>")
    .setExample("{prefix}{name} cat_ears blue_hair")
    .setNote(`Sites:\n${siteList}`)
    .setReact("🎨")
    .setRateLimit(8_000, 3)
    .setHandler(async (interaction) => {
        const body = (interaction.body || "").trim();
        if (!body) {
            return interaction.reply(
                interaction.usage(`\nSites:\n${siteList}`),
            );
        }

        let site = "safebooru";
        let tags = body;

        if (siteSet.has(interaction.commandName)) {
            site = interaction.commandName;
        } else {
            const [first, ...rest] = body.split(/\s+/);
            if (siteSet.has(first)) {
                site = first;
                tags = rest.join(" ").trim();
            }
        }

        if (!tags) {
            return interaction.reply("Provide at least one tag.");
        }

        await interaction.typing();
        let post;
        let usedSite = site;
        try {
            post = await getBooru().random(tags, { site, limit: 50 });
        } catch {
            if (site !== "safebooru") {
                post = await getBooru().random(tags, {
                    site: "safebooru",
                    limit: 50,
                });
                usedSite = "safebooru";
            }
        }
        if (!post) {
            return interaction.reply(`No results for \`${tags}\` on ${site}.`);
        }

        const { data: buffer } = await axios.get(post.url, {
            responseType: "arraybuffer",
            timeout: 30_000,
        });

        const caption = [
            `*${usedSite}* • id ${post.id}`,
            `${post.width}x${post.height} • ${post.score}`,
            post.source ? `${post.source}` : null,
        ]
            .filter(Boolean)
            .join("\n");

        return interaction.reply({
            image: Buffer.from(buffer),
            caption,
        });
    });
