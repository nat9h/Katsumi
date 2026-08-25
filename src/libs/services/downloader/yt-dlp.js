/**
 * @fileoverview yt-dlp wrapper — search, info, download.
 * Runs node from process.execPath. Optional cookies — see buildArgs.
 * @module services/yt-dlp
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import logger from "#libs/utils/logger";
import { tmpFile } from "#libs/utils/tmp";

const execFileAsync = promisify(execFile);

const COOKIES_FILE = join(process.cwd(), "cookies", "yt.txt");

/**
 * Build the full yt-dlp argv. Cookies are attached only when `cookies/yt.txt`
 * exists at call time, so swapping the file in/out doesn't require a restart.
 *
 * Cookies only buy age-restricted and private videos — public ones download
 * identically without them. They are safe here *because* the client is pinned:
 * left to itself yt-dlp switches to _DEFAULT_AUTHED_CLIENTS on seeing cookies
 * and drops every client without SUPPORTS_COOKIES, leaving only ones that need
 * a GVS PO token provider we do not run.
 *
 * @param {string[]} extra
 * @returns {string[]}
 */
function buildArgs(extra) {
    const args = [
        "--js-runtimes",
        `node:${process.execPath}`,
        "--remote-components",
        "ejs:npm",
        "--no-warnings",
        "--extractor-args",
        "youtube:player_client=web_embedded",
    ];
    if (existsSync(COOKIES_FILE)) {
        args.push("--cookies", COOKIES_FILE);
    }
    args.push(...extra);
    return args;
}

/**
 * @param {string} title
 * @returns {string}
 */
function sanitizeTitle(title) {
    return (title || "download").replace(/[\\/:*?"<>|]/g, "").slice(0, 60);
}

/**
 * Pick the highest-resolution thumbnail yt-dlp returned.
 *
 * yt-dlp's `thumbnails` array is sorted by ascending preference, but isn't
 * always sorted by pixel size — the explicit `width`/`height` fields are a
 * better signal. We prefer width × height, fall back to width alone, then
 * preference, and finally `d.thumbnail` if no array is present.
 *
 * @param {{ thumbnail?: string, thumbnails?: Array<{ url?: string, width?: number, height?: number, preference?: number }> }} d
 * @returns {string|null}
 */
function pickThumbnail(d) {
    const list = Array.isArray(d.thumbnails) ? d.thumbnails : [];
    let best = null;
    let bestScore = -1;
    for (const t of list) {
        if (!t?.url) {
            continue;
        }
        const w = Number(t.width) || 0;
        const h = Number(t.height) || 0;
        const pref = Number(t.preference) || 0;
        const score = w * h || w || pref;
        if (score > bestScore) {
            bestScore = score;
            best = t.url;
        }
    }
    return best || d.thumbnail || null;
}

/**
 * Invoke yt-dlp with `execFile` (no shell, args passed as an array so values
 * with spaces/quotes are safe). On non-zero exit, surface the last few lines
 * of stderr for a useful error message.
 *
 * @param {string[]} extra
 * @param {{ timeout?: number, maxBuffer?: number }} [limits]
 * @returns {Promise<string>} stdout
 */
async function runYtDlp(
    extra,
    limits = { timeout: 30_000, maxBuffer: 50 * 1024 * 1024 },
) {
    try {
        const { stdout } = await execFileAsync("yt-dlp", buildArgs(extra), {
            timeout: limits.timeout,
            maxBuffer: limits.maxBuffer,
            windowsHide: true,
        });
        return stdout;
    } catch (err) {
        const stderr = String(err.stderr || "").trim();
        logger.error(
            {
                argv: buildArgs(extra),
                cwd: process.cwd(),
                cookies: existsSync(COOKIES_FILE),
                path: process.env.PATH,
                stderr,
            },
            "yt-dlp failed",
        );
        const tail = stderr.split("\n").slice(-3).join(" ").slice(0, 240);
        throw new Error(tail || err.message || "yt-dlp failed");
    }
}

/**
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {Promise<object[]>}
 */
export async function search(query, limit = 10) {
    const stdout = await runYtDlp([
        "--dump-json",
        "--flat-playlist",
        `ytsearch${limit}:${query}`,
    ]);

    return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            const d = JSON.parse(line);
            return {
                id: d.id,
                title: d.title,
                url:
                    d.url ||
                    d.webpage_url ||
                    `https://www.youtube.com/watch?v=${d.id}`,
                duration: d.duration,
                channel: d.channel || d.uploader,
                thumbnail:
                    pickThumbnail(d) ||
                    (d.id
                        ? `https://i.ytimg.com/vi/${d.id}/maxresdefault.jpg`
                        : null),
            };
        });
}

/**
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function info(url) {
    const stdout = await runYtDlp(["--dump-json", "--no-playlist", url]);
    const d = JSON.parse(stdout.trim());
    return {
        id: d.id,
        title: d.title,
        description: d.description || "",
        duration: d.duration,
        channel: d.channel || d.uploader,
        thumbnail: pickThumbnail(d),
        url: d.webpage_url,
    };
}

/**
 * @param {string} url
 * @param {"audio"|"video"} [type="audio"]
 * @param {{ title?: string, timeout?: number }} [opts]
 * @returns {Promise<{ buffer: Buffer, fileName: string, mimetype: string }>}
 */
export async function download(url, type = "audio", opts = {}) {
    const isVideo = type === "video";
    const ext = isVideo ? "mp4" : "m4a";
    const outFile = await tmpFile(ext);

    try {
        const args = ["-o", outFile, "--no-playlist"];
        if (isVideo) {
            args.push(
                "-f",
                "best[ext=mp4][height<=480]/best[height<=480]/" +
                    "bv*[height<=480][vcodec^=avc1]+ba[acodec^=mp4a]/" +
                    "bv*[height<=480]+ba/b",
                "--merge-output-format",
                "mp4",
            );
        } else {
            args.push(
                "-f",
                "bestaudio",
                "--extract-audio",
                "--audio-format",
                "m4a",
            );
        }
        args.push(url);

        await runYtDlp(args, {
            timeout: opts.timeout || 180_000,
            maxBuffer: 300 * 1024 * 1024,
        });

        const buffer = await readFile(outFile);
        return {
            buffer,
            fileName: `${sanitizeTitle(opts.title)}.${ext}`,
            mimetype: isVideo ? "video/mp4" : "audio/mp4",
        };
    } finally {
        await unlink(outFile).catch(() => {});
    }
}
