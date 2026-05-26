/**
 * @fileoverview Media conversion utilities using ffmpeg.
 * Provides functions for extracting audio, converting stickers to images/video.
 * @module utils/converter/media
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ffmpeg from "fluent-ffmpeg";

/** @type {string} Temporary directory for ffmpeg operations. */
const TMP_DIR = join(process.cwd(), "tmp");

/**
 * Run an ffmpeg operation on a temp input/output file pair.
 * Handles file creation, conversion, and cleanup automatically.
 *
 * @param {Buffer} inputBuffer - Input media buffer.
 * @param {string} inExt - Input file extension (without dot).
 * @param {string} outExt - Output file extension (without dot).
 * @param {(cmd: import('fluent-ffmpeg').FfmpegCommand) => void} configure - Callback to configure ffmpeg options.
 * @returns {Promise<Buffer>} Converted output buffer.
 * @throws {Error} If ffmpeg conversion fails.
 */
async function runFfmpeg(inputBuffer, inExt, outExt, configure) {
    await mkdir(TMP_DIR, { recursive: true });

    const id = randomUUID();
    const inputFile = join(TMP_DIR, `${id}.${inExt}`);
    const outputFile = join(TMP_DIR, `${id}_out.${outExt}`);

    await writeFile(inputFile, inputBuffer);

    try {
        await new Promise((resolve, reject) => {
            const cmd = ffmpeg(inputFile);
            configure(cmd);
            cmd.save(outputFile).on("end", resolve).on("error", reject);
        });
        return await readFile(outputFile);
    } finally {
        await unlink(inputFile).catch(() => {});
        await unlink(outputFile).catch(() => {});
    }
}

/**
 * Extract the audio stream from a video/audio buffer and re-encode as MP3.
 *
 * @param {Buffer} buffer - Input media buffer.
 * @param {string} [inExt="mp4"] - Hint for input file extension.
 * @returns {Promise<Buffer>} MP3 audio buffer.
 */
export async function extractAudio(buffer, inExt = "mp4") {
    return runFfmpeg(buffer, inExt, "mp3", (cmd) => {
        cmd.outputOptions([
            "-vn",
            "-acodec",
            "libmp3lame",
            "-ab",
            "128k",
            "-ar",
            "44100",
            "-ac",
            "2",
        ]);
    });
}

/**
 * Convert audio buffer to WAV (PCM s16le, 44100Hz, stereo).
 * Useful for audio processing and compatibility.
 *
 * @param {Buffer} buffer - Input audio buffer.
 * @param {string} [inExt="ogg"] - Input file extension hint.
 * @returns {Promise<Buffer>} WAV audio buffer.
 */
export async function toWav(buffer, inExt = "ogg") {
    return runFfmpeg(buffer, inExt, "wav", (cmd) => {
        cmd.outputOptions([
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "44100",
            "-ac",
            "2",
        ]);
    });
}

/**
 * Convert a WebP sticker buffer to a PNG image.
 * Extracts only the first frame for animated stickers.
 *
 * @param {Buffer} buffer - WebP sticker buffer.
 * @returns {Promise<Buffer>} PNG image buffer.
 */
export async function stickerToImage(buffer) {
    return runFfmpeg(buffer, "webp", "png", (cmd) => {
        cmd.outputOptions(["-vframes", "1"]);
    });
}

/**
 * Convert an animated WebP sticker buffer to MP4 video.
 * Outputs 512x512 at 30fps with H.264 encoding.
 *
 * @param {Buffer} buffer - WebP sticker buffer.
 * @returns {Promise<Buffer>} MP4 video buffer.
 */
export async function stickerToVideo(buffer) {
    return runFfmpeg(buffer, "webp", "mp4", (cmd) => {
        cmd.outputOptions([
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=white,fps=30",
            "-movflags",
            "+faststart",
            "-preset",
            "veryfast",
            "-an",
        ]);
    });
}

/**
 * Decode audio buffer to raw PCM (s16le, mono, 16kHz).
 * Used for audio fingerprinting and recognition.
 *
 * @param {Buffer} inputBuffer - Input audio buffer.
 * @param {string} [inExt="mp3"] - Input file extension hint.
 * @returns {Promise<Buffer>} Raw PCM buffer (s16le, 16kHz, mono).
 */
export async function decodeToRawPCM(inputBuffer, inExt = "mp3") {
    return runFfmpeg(inputBuffer, inExt, "pcm", (cmd) => {
        cmd.outputOptions([
            "-vn",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
        ]);
    });
}
