/**
 * @fileoverview One temp directory for the whole bot.
 *
 * Under the project root, not `os.tmpdir()`: ffmpeg and sticker work writes
 * files far larger than a typical `/tmp` tmpfs, and keeping them beside the
 * project makes leftovers visible and easy to wipe.
 * @module libs/utils/tmp
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** @type {string} */
export const TMP_DIR = join(process.cwd(), "tmp");

/**
 * Ensure TMP_DIR exists and return a unique path inside it.
 *
 * @param {string} [ext] - Extension without the dot.
 * @returns {Promise<string>}
 */
export async function tmpFile(ext) {
    await mkdir(TMP_DIR, { recursive: true });
    return join(TMP_DIR, ext ? `${randomUUID()}.${ext}` : randomUUID());
}

/**
 * Delete paths, ignoring anything already gone.
 *
 * @param {...string} paths
 * @returns {Promise<void>}
 */
export async function cleanup(...paths) {
    await Promise.all(
        paths
            .filter(Boolean)
            .map((p) => rm(p, { force: true }).catch(() => {})),
    );
}
