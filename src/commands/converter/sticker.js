/**
 * @fileoverview Sticker command — all-in-one sticker creator with watermark,
 * quote chat, meme, emoji kitchen, and URL support.
 * @module commands/converter/sticker
 */

import { imgur } from "#libs/storage/uploader";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { createSticker } from "#libs/utils/converter/sticker";
import { fetchMedia } from "#libs/utils/message";
import { fetchProfilePicture } from "#libs/utils/profile";

export default new CommandBuilder()
    .setName("sticker")
    .setAliases("s", "stiker")
    .setDescription("All-in-one sticker creator")
    .setUsage("{prefix}{name} [-wm pack|author] [-qc text] [top|bottom]")
    .setExample("{prefix}s -wm MyPack|MyName")
    .setNote(
        [
            "Features:",
            "• Reply/send image or video → sticker",
            "• Reply sticker → repack with new pack/author",
            "• Reply text or -qc <text> → quote chat sticker",
            "• Image/sticker + top|bottom → meme sticker",
            "• -wm pack|author → custom watermark",
            "• Single emoji → animated emoji sticker",
            "• Two emojis → emoji kitchen mix",
            "• @mention → profile picture sticker",
            "• URL → download and convert to sticker",
            "• No input → random sticker",
        ].join("\n"),
    )
    .setReact("🎭")
    .setRateLimit(5000, 3)
    .setHandler(async (interaction) => {
        const { userName: pushName, mentions, sock, quoted } = interaction;

        const { flags, positional } = interaction.parseFlags({
            wm: { type: "string" },
            qc: { type: "string" },
        });
        const text = positional.join(" ");
        const meta = { pack: "@natsumiworld.", author: pushName };

        const send = async (buf, opts = {}) => {
            const sticker = await createSticker(buf, opts.isVideo || false, {
                ...meta,
                skipConvert: opts.skipConvert || false,
            });
            return interaction.reply({ sticker });
        };

        if (flags.wm !== undefined) {
            const parts = flags.wm.split("|").map((s) => s.trim());
            meta.pack = parts[0] || meta.pack;
            meta.author = parts[1] || meta.author;

            const media = await fetchMedia(interaction, {
                maxBytes: 8 * 1024 * 1024,
            });
            if (!media || !["image", "video", "sticker"].includes(media.type)) {
                return interaction.reply(
                    "Send or reply to an image, video, or sticker.",
                );
            }
            return send(media.buffer, {
                isVideo: media.type === "video",
                skipConvert: media.type === "sticker",
            });
        }

        if (mentions.length > 0) {
            const url = await fetchProfilePicture(
                sock,
                mentions[0],
                "image",
            ).catch(() => null);
            if (!url) {
                return interaction.reply("Could not fetch profile picture.");
            }
            return send(
                Buffer.from(await fetch(url).then((r) => r.arrayBuffer())),
            );
        }

        const isQc = flags.qc !== undefined;
        const hasQuotedMedia =
            quoted?.message?.imageMessage ||
            quoted?.message?.videoMessage ||
            quoted?.message?.stickerMessage ||
            quoted?.message?.audioMessage ||
            quoted?.message?.documentMessage;
        const isAutoQc = !text && !isQc && !!quoted?.text && !hasQuotedMedia;

        if (isQc || isAutoQc) {
            const qcText = isQc
                ? [flags.qc, ...positional].join(" ").trim() ||
                  quoted?.text ||
                  ""
                : quoted?.text || "";
            if (!qcText) {
                return interaction.reply(
                    "Provide text or reply to a text message for QC.",
                );
            }

            let sender = quoted?.sender || "";
            if (!sender && !interaction.isGroup) {
                sender = interaction.chatJid;
            }
            sender = sender || interaction.user;
            let resolvedSender = sender;
            if (sender.endsWith("@lid") && interaction.isGroup) {
                try {
                    const meta = await interaction.getGroupMeta();
                    const participant = meta?.participants?.find(
                        (p) => p.lid === sender || p.id === sender,
                    );
                    if (participant?.id?.endsWith("@s.whatsapp.net")) {
                        resolvedSender = participant.id;
                    }
                } catch {}
            }

            const isQuotedFromSelf = resolvedSender === interaction.user;
            const pfp =
                (await fetchProfilePicture(sock, resolvedSender, "image").catch(
                    () => null,
                )) ||
                "https://i.pinimg.com/736x/f1/26/e3/f126e305c9a2b882584b2afd.jpg";

            const contact =
                interaction.store.getContact(resolvedSender) ||
                interaction.store.getContact(sender);
            const senderName = isQuotedFromSelf
                ? interaction.msg.pushName || "Unknown"
                : contact?.notify ||
                  contact?.name ||
                  resolvedSender.split("@")[0] ||
                  "Unknown";

            const qcPayload = {
                type: "image",
                format: "png",
                backgroundColor: "#FFFFFF",
                width: 512,
                height: 786,
                scale: 2,
                messages: [
                    {
                        avatar: true,
                        from: {
                            id: 1,
                            name: senderName,
                            photo: { url: pfp },
                        },
                        text: qcText,
                        replyMessage: {},
                    },
                ],
            };

            let imageBuffer = null;

            const res = await fetch("https://bot.lyo.su/quote/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(qcPayload),
            });
            if (res.ok) {
                const data = await res.json();
                if (data?.result?.image) {
                    imageBuffer = Buffer.from(data.result.image, "base64");
                }
            }

            if (!imageBuffer) {
                const res = await fetch("https://qc.chitoge.win/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(qcPayload),
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data?.result?.image) {
                        imageBuffer = Buffer.from(data.result.image, "base64");
                    }
                }
            }

            if (!imageBuffer) {
                return interaction.reply(
                    "Failed to generate quote sticker. QC API unavailable.",
                );
            }
            return send(imageBuffer);
        }

        const media = await fetchMedia(interaction, {
            maxBytes: 8 * 1024 * 1024,
        }).catch(() => null);

        if (media) {
            if (!["image", "video", "sticker"].includes(media.type)) {
                return interaction.reply(
                    "Send or reply to an image, video, or sticker.",
                );
            }
            if (
                text.includes("|") &&
                (media.type === "image" || media.type === "sticker")
            ) {
                const url = await imgur(media.buffer).catch(() => null);
                if (!url) {
                    return interaction.reply(
                        "Failed to upload image for meme generation.",
                    );
                }
                const [top, bot] = text
                    .split("|")
                    .map((t) => encodeURIComponent(t.trim() || "_"));
                const res = await fetch(
                    `https://api.memegen.link/images/custom/${top}/${bot}.png?background=${url}`,
                );
                if (!res.ok) {
                    return interaction.reply(
                        "Meme API failed. Try again later.",
                    );
                }
                return send(Buffer.from(await res.arrayBuffer()));
            }

            return send(media.buffer, {
                isVideo: media.type === "video",
                skipConvert: media.type === "sticker",
            });
        }

        const urlMatch = text.match(/https?:\/\/[^\s]+/i);
        if (urlMatch) {
            const res = await fetch(urlMatch[0]);
            if (!res.ok) {
                return interaction.reply("Failed to fetch URL.");
            }
            return send(Buffer.from(await res.arrayBuffer()));
        }

        if (text) {
            const emojis = text.match(
                /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu,
            );

            if (emojis?.length === 1 && emojis[0] === text.trim()) {
                const cp = [...emojis[0]]
                    .map((c) => c.codePointAt(0).toString(16))
                    .join("-");
                const res = await fetch(
                    `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.webp`,
                );
                if (res.ok) {
                    return send(Buffer.from(await res.arrayBuffer()), {
                        skipConvert: true,
                    });
                }
            }

            if (emojis?.length === 2 && emojis.join("") === text.trim()) {
                const url = `https://tenor.googleapis.com/v2/featured?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(emojis[0])}_${encodeURIComponent(emojis[1])}`;
                const data = await fetch(url).then((r) => r.json());
                if (data.results?.length > 0) {
                    const img = await fetch(
                        data.results[0].media_formats.png_transparent.url,
                    );
                    return send(Buffer.from(await img.arrayBuffer()));
                }
                return interaction.reply("No emoji mix result found.");
            }
        }

        const res = await fetch("https://sticker.rmdni.id");
        if (res.ok) {
            return send(Buffer.from(await res.arrayBuffer()));
        }

        return interaction.reply(
            "Send or reply to an image/video, send an emoji, or a URL.",
        );
    });
