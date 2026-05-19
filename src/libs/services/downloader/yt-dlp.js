/**
 * @fileoverview yt-dlp wrapper — search, info, download.
 * Uses Deno runtime, cookies, and remote components.
 * @module services/yt-dlp
 */

import { exec } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const COOKIES_DIR = join(process.cwd(), "cookies");
const TMP = process.platform === "win32" ? join(process.cwd(), "tmp") : "/tmp";

function detectCookies(url) {
    if (/facebook\.com|fb\.watch/i.test(url)) {
        const fb = join(COOKIES_DIR, "fb.txt");
        if (existsSync(fb)) {
            return fb;
        }
    }
    if (/instagram\.com/i.test(url)) {
        const ig = join(COOKIES_DIR, "ig.txt");
        if (existsSync(ig)) {
            return ig;
        }
    }
    const yt = join(COOKIES_DIR, "yt.txt");
    if (existsSync(yt)) {
        return yt;
    }
    return null;
}

function buildArgs(extra = [], url = "") {
    const args = ["--js-runtimes", "deno", "--remote-components", "ejs:npm"];
    const cookie = detectCookies(url);
    if (cookie) {
        args.push("--cookies", cookie);
    }
    args.push(...extra);
    return args.map((a) => `"${a}"`).join(" ");
}

function sanitizeTitle(title) {
    return (title || "download").replace(/[\\/:*?"<>|]/g, "").slice(0, 60);
}

/**
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {Promise<object[]>}
 */
export async function search(query, limit = 10) {
    const args = buildArgs([
        "--dump-json",
        "--flat-playlist",
        "--no-warnings",
        `ytsearch${limit}:${query}`,
    ]);

    const { stdout } = await execAsync(`yt-dlp ${args}`, {
        timeout: 30_000,
        maxBuffer: 50 * 1024 * 1024,
    });

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
                thumbnail: d.thumbnail || d.thumbnails?.[0]?.url,
            };
        });
}

/**
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function info(url) {
    const args = buildArgs(
        ["--dump-json", "--no-warnings", "--no-playlist", url],
        url,
    );
    const { stdout } = await execAsync(`yt-dlp ${args}`, {
        timeout: 30_000,
        maxBuffer: 50 * 1024 * 1024,
    });
    const d = JSON.parse(stdout.trim());
    return {
        id: d.id,
        title: d.title,
        description: d.description || "",
        duration: d.duration,
        channel: d.channel || d.uploader,
        thumbnail: d.thumbnail,
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
    const timeout = opts.timeout || 180_000;
    const format =
        type === "video" ? "best[ext=mp4][height<=480]" : "bestaudio[ext=m4a]";
    const ext = type === "video" ? "mp4" : "m4a";
    const outFile = join(TMP, `yt_${Date.now()}.${ext}`);

    const args = buildArgs(
        ["-f", format, "-o", outFile, "--no-playlist", "--no-warnings", url],
        url,
    );
    await execAsync(`yt-dlp ${args}`, {
        timeout,
        maxBuffer: 300 * 1024 * 1024,
    });

    const buffer = readFileSync(outFile);
    unlinkSync(outFile);

    const title = sanitizeTitle(opts.title);

    return {
        buffer,
        fileName: `${title}.${ext}`,
        mimetype: type === "video" ? "video/mp4" : "audio/mp4",
    };
}
