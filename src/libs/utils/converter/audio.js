/**
 * @fileoverview Audio conversion utility using ffmpeg.
 * Converts audio buffers to Opus (OGG) format suitable for WhatsApp voice notes.
 * @module utils/converter/audio
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { TMP_DIR } from "#libs/utils/tmp";

/**
 * @param {Buffer} inputBuffer - Raw audio buffer to convert.
 * @param {number|null} [maxDuration=null] - Max duration in seconds (null = no limit).
 * @returns {Promise<Buffer>} Converted Opus audio buffer.
 * @throws {Error} If ffmpeg conversion fails.
 */
export async function convertAudio(inputBuffer, maxDuration = null) {
    const tmpDir = TMP_DIR;
    await mkdir(tmpDir, { recursive: true });

    const id = randomUUID();
    const inputFile = join(tmpDir, `${id}_input`);
    const outputFile = join(tmpDir, `${id}.opus`);

    await writeFile(inputFile, inputBuffer);

    try {
        const cmd = ffmpeg(inputFile)
            .audioCodec("libopus")
            .audioChannels(1)
            .audioFrequency(16000)
            .audioBitrate("128k");

        if (maxDuration !== null) {
            cmd.duration(maxDuration);
        }

        await new Promise((resolve, reject) => {
            cmd.output(outputFile).on("end", resolve).on("error", reject).run();
        });

        return await readFile(outputFile);
    } finally {
        await unlink(inputFile).catch(() => {});
        await unlink(outputFile).catch(() => {});
    }
}
