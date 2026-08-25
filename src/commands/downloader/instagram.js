/**
 * @fileoverview Instagram command — download or search posts.
 * URL → download media. Text → search by hashtag.
 * @module commands/downloader/instagram
 */

import axios from "axios";
import instagram from "#libs/scrapers/instagram";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { formatCount } from "#libs/utils/format";
import { selectFromList } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("instagram")
    .setAliases("ig", "igdl", "igdown", "insta", "igsearch")
    .setDescription("Download or search Instagram posts")
    .setUsage("{prefix}{name} <url|query>")
    .setExample(
        "{prefix}{name} https://www.instagram.com/reel/xxx\n{prefix}{name} kucinglucu",
    )
    .setNote("URL → download. @username → profile. Text → hashtag search.")
    .setReact("📸")
    .setRateLimit(10_000, 2)
    .setHandler(async (interaction) => {
        const query = interaction.urlArg();

        if (!query) {
            return interaction.reply(interaction.usage());
        }

        await interaction.typing();

        const profileUrl = query.match(
            /(?:instagram\.com|instagr\.am)\/(?!p\/|reel|reels|tv\/|stories\/|explore\/|s\/)([A-Za-z0-9._]+)\/?$/i,
        );
        const atName = query.match(/^@([A-Za-z0-9._]+)$/);
        const usernameQuery = profileUrl?.[1] || atName?.[1];

        if (usernameQuery) {
            const { user, posts, stories, highlights } =
                await instagram.fetchProfile(usernameQuery);

            const info = [
                `👤 *@${user.username}*${user.isVerified ? " ✅" : ""}${user.fullName ? `\n${user.fullName}` : ""}`,
                `📊 ${formatCount(user.posts)} posts • ${formatCount(user.followers)} followers • ${formatCount(user.following)} following`,
                ...(user.bio ? ["", user.bio] : []),
                "",
                `📸 ${posts.length} recent posts • 📖 ${stories.length} stories • 📌 ${highlights.length} highlights`,
            ].join("\n");

            const choices = [
                ...posts.map((p) => ({
                    kind: "post",
                    ref: p.shortcode,
                    label: `📸 ${p.caption?.slice(0, 40) || "(no caption)"} (❤️${formatCount(p.likes)})`,
                })),
                ...(stories.length
                    ? [
                          {
                              kind: "story",
                              ref: null,
                              label: `📖 Active stories (${stories.length})`,
                          },
                      ]
                    : []),
                ...highlights.map((h) => ({
                    kind: "highlight",
                    ref: h.id,
                    label: `📌 ${h.title || "Highlight"}`,
                })),
            ];

            if (!choices.length) {
                return interaction.reply(
                    `${info}\n\n${user.isPrivate ? "🔒 Private account — nothing accessible." : "No content found."}`,
                );
            }

            const selected = await selectFromList({
                interaction,
                items: choices,
                format: (c, i) => `${i + 1}. ${c.label}`,
                header: {
                    image: user.avatar ? { url: user.avatar } : null,
                    caption: info,
                },
            });

            if (!selected) {
                return;
            }

            if (selected.kind === "story") {
                for (const [i, m] of stories.entries()) {
                    const payload =
                        m.type === "video"
                            ? {
                                  video: Buffer.from(
                                      (
                                          await axios.get(m.url, {
                                              responseType: "arraybuffer",
                                              timeout: 60_000,
                                          })
                                      ).data,
                                  ),
                              }
                            : { image: { url: m.url } };
                    if (i === 0) {
                        payload.caption = `📖 @${user.username} stories`;
                    }
                    await interaction.followUp(payload);
                }
                return;
            }

            const targetUrl =
                selected.kind === "highlight"
                    ? `https://www.instagram.com/stories/highlights/${selected.ref}/`
                    : `https://www.instagram.com/p/${selected.ref}/`;
            const post = await instagram.download(targetUrl);

            const caption = [
                `👤 @${post.author.username}`,
                ...(post.type === "Highlight"
                    ? [`📌 ${post.title || "Highlight"}`]
                    : [
                          `❤️ ${formatCount(post.stats.likes)} • 💬 ${formatCount(post.stats.comments)}`,
                      ]),
                ...(post.caption ? ["", post.caption] : []),
            ].join("\n");

            for (const [i, media] of post.media.entries()) {
                const payload =
                    media.type === "video"
                        ? {
                              video: Buffer.from(
                                  (
                                      await axios.get(media.url, {
                                          responseType: "arraybuffer",
                                          timeout: 60_000,
                                      })
                                  ).data,
                              ),
                          }
                        : { image: { url: media.url } };
                if (i === 0) {
                    payload.caption = caption;
                }
                await interaction.followUp(payload);
            }
            return;
        }

        if (/(?:instagram\.com|instagr\.am)\//i.test(query)) {
            const post = await instagram.download(query);

            const lines = [
                `👤 *@${post.author.username}*${post.author.fullName ? ` (${post.author.fullName})` : ""}`,
            ];

            if (post.type === "Highlight") {
                lines.push(
                    `📌 *${post.title || "Highlight"}* — ${post.media.length} items`,
                );
            } else {
                lines.push(
                    `❤️ ${formatCount(post.stats.likes)} • 💬 ${formatCount(post.stats.comments)}`,
                    ...(post.stats.views
                        ? [`👁 ${formatCount(post.stats.views)} views`]
                        : []),
                    ...(post.stats.plays
                        ? [`▶️ ${formatCount(post.stats.plays)} plays`]
                        : []),
                );
            }

            if (post.caption) {
                lines.push("", post.caption);
            }

            if (post.comments.length) {
                const top = post.comments
                    .sort((a, b) => b.likes - a.likes)
                    .slice(0, 5);
                lines.push("", "💬 *Top Comments:*");
                for (const c of top) {
                    const likeStr = c.likes
                        ? ` (❤️${formatCount(c.likes)})`
                        : "";
                    lines.push(
                        `• @${c.username}: ${c.text.slice(0, 100)}${c.text.length > 100 ? "..." : ""}${likeStr}`,
                    );
                }
            }

            const caption = lines.join("\n");

            if (post.media.length > 1) {
                const albumItems = [];
                for (const media of post.media) {
                    if (media.type === "video") {
                        const { data } = await axios.get(media.url, {
                            responseType: "arraybuffer",
                            timeout: 60_000,
                        });
                        albumItems.push({
                            buffer: Buffer.from(data),
                            type: "video",
                        });
                    } else {
                        albumItems.push({ url: media.url, type: "image" });
                    }
                }
                await interaction.sendAlbum(albumItems, { caption });
            } else {
                const media = post.media[0];
                if (media.type === "video") {
                    const { data } = await axios.get(media.url, {
                        responseType: "arraybuffer",
                        timeout: 60_000,
                    });
                    await interaction.followUp({
                        video: Buffer.from(data),
                        caption,
                    });
                } else {
                    await interaction.followUp({
                        image: { url: media.url },
                        caption,
                    });
                }
            }
        } else {
            const { tag, mediaCount, posts } =
                await instagram.searchPosts(query);

            if (!posts.length) {
                return interaction.reply(`No posts found for #${tag}.`);
            }

            const selected = await selectFromList({
                interaction,
                items: posts,
                format: (p, i) =>
                    `${i + 1}. *@${p.author}* — ${p.caption?.slice(0, 40) || "(no caption)"}${p.caption?.length > 40 ? "..." : ""} (❤️${formatCount(p.likes)})`,
                header: {
                    image: posts[0].thumbnail
                        ? { url: posts[0].thumbnail }
                        : null,
                    caption: `🔎 *#${tag}* — ${formatCount(mediaCount)} posts`,
                },
            });

            if (!selected) {
                return;
            }

            const postUrl = `https://www.instagram.com/p/${selected.shortcode}/`;
            const post = await instagram.download(postUrl);

            const caption = [
                `👤 @${post.author.username}`,
                `❤️ ${formatCount(post.stats.likes)} • 💬 ${formatCount(post.stats.comments)}`,
                "",
                post.caption || "",
            ].join("\n");

            for (const [i, media] of post.media.entries()) {
                if (media.type === "video") {
                    const { data } = await axios.get(media.url, {
                        responseType: "arraybuffer",
                        timeout: 60_000,
                    });
                    await interaction.followUp({
                        video: Buffer.from(data),
                        ...(i === 0 ? { caption } : {}),
                    });
                } else {
                    await interaction.followUp({
                        image: { url: media.url },
                        ...(i === 0 ? { caption } : {}),
                    });
                }
            }
        }
    });
