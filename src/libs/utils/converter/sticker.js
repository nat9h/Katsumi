/**
 * @fileoverview Sticker creation utility.
 * Converts image/video buffers to WebP stickers with EXIF metadata
 * for WhatsApp sticker packs.
 * @module utils/converter/sticker
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import webpmux from "node-webpmux";

/** @type {string} Temporary directory for ffmpeg operations. */
const TMP_DIR = join(process.cwd(), "tmp");

const VF_FILTER = [
    "scale=320:320:force_original_aspect_ratio=decrease",
    "fps=15",
    "pad=320:320:-1:-1:color=white@0.0",
    "split[a][b]",
    "[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p]",
    "[b][p]paletteuse",
].join(",");

/**
 * Build EXIF metadata buffer for a WhatsApp sticker.
 *
 * @param {string} pack - Sticker pack name.
 * @param {string} author - Sticker pack author.
 * @returns {Buffer} EXIF metadata buffer.
 */
function buildExif(pack, author) {
    const json = JSON.stringify({
        "sticker-pack-id": "com.bot.sticker",
        "sticker-pack-name": pack,
        "sticker-pack-publisher": author,
        emojis: ["❤️"],
        "is-avatar-sticker": 0,
    });

    const data = Buffer.from(json, "utf-8");
    const exif = Buffer.concat([
        Buffer.from([
            0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41,
            0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
        ]),
        data,
    ]);

    exif.writeUIntLE(data.length, 14, 4);
    return exif;
}

/**
 * Inject EXIF into a WebP buffer.
 *
 * @param {Buffer} webpBuffer
 * @param {string} pack
 * @param {string} author
 * @returns {Promise<Buffer>}
 */
async function injectExif(webpBuffer, pack, author) {
    const image = new webpmux.Image();
    await image.load(webpBuffer);
    image.exif = buildExif(pack, author);
    return image.save(null);
}

/**
 * Convert an image or video buffer to a WebP sticker with metadata.
 * If skipConvert is true, assumes input is already WebP and only injects EXIF.
 *
 * @param {Buffer} buffer - Input media buffer.
 * @param {boolean} [isVideo=false] - Whether the input is a video.
 * @param {object} [meta] - Sticker metadata.
 * @param {string} [meta.pack] - Sticker pack name.
 * @param {string} [meta.author] - Sticker pack author.
 * @param {boolean} [meta.skipConvert] - Skip ffmpeg, just repack EXIF.
 * @returns {Promise<Buffer>} WebP sticker buffer with EXIF metadata.
 */
export async function createSticker(buffer, isVideo = false, meta = {}) {
    const pack = meta.pack || "@natsumiworld";
    const author = meta.author || "";

    if (meta.skipConvert) {
        return injectExif(buffer, pack, author);
    }

    await mkdir(TMP_DIR, { recursive: true });

    const id = randomUUID();
    const inputFile = join(TMP_DIR, `${id}.${isVideo ? "mp4" : "png"}`);
    const outputFile = join(TMP_DIR, `${id}.webp`);

    await writeFile(inputFile, buffer);

    try {
        await new Promise((resolve, reject) => {
            const cmd = ffmpeg(inputFile);

            if (isVideo) {
                cmd.addOutputOptions([
                    "-vcodec",
                    "libwebp",
                    "-lavfi",
                    VF_FILTER,
                    "-loop",
                    "0",
                    "-ss",
                    "00:00:00",
                    "-t",
                    "00:00:20",
                    "-preset",
                    "default",
                    "-an",
                    "-vsync",
                    "0",
                ]);
            } else {
                cmd.addOutputOptions([
                    "-vcodec",
                    "libwebp",
                    "-lavfi",
                    VF_FILTER,
                ]);
            }

            cmd.save(outputFile).on("end", resolve).on("error", reject);
        });

        const webpBuffer = await readFile(outputFile);
        return injectExif(webpBuffer, pack, author);
    } finally {
        await unlink(inputFile).catch(() => {});
        await unlink(outputFile).catch(() => {});
    }
}
