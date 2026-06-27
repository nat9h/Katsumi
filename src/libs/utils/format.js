/**
 * @fileoverview Formatting, text, and time utility functions.
 * @module utils/format
 */

import { inspect } from "node:util";

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {string} text
 * @param {number} [max=3800]
 * @returns {string}
 */
export function truncate(text, max = 3800) {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}\n… (${text.length - max} chars truncated)`;
}

/**
 * @param {boolean} v
 * @returns {string}
 */
export function statusIcon(v) {
    return v ? "✅" : "❌";
}

/**
 * @param {string} str
 * @returns {string}
 */
export function sanitizeSecrets(str) {
    if (typeof str !== "string") {
        return str;
    }

    const sensitive = Object.entries(process.env)
        .filter(
            ([k, v]) =>
                /(SECRET|TOKEN|KEY|PASSWORD|PWD|AUTH)/i.test(k) &&
                v?.length > 3,
        )
        .map(([, v]) => v)
        .sort((a, b) => b.length - a.length);

    let out = str;
    for (const v of sensitive) {
        out = out.replace(
            new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            "[REDACTED]",
        );
    }
    return out;
}

/**
 * @param {*} value
 * @returns {string}
 */
export function fmt(value) {
    if (typeof value === "string") {
        return value;
    }
    return inspect(value, { depth: 4, colors: false });
}

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * @param {string} input
 * @returns {number}
 */
export function parseDuration(input) {
    const re = /(\d+)([smhd])/gi;
    let total = 0;
    let matched = false;
    let m;
    while ((m = re.exec(input)) !== null) {
        matched = true;
        total += parseInt(m[1], 10) * UNIT_MS[m[2].toLowerCase()];
    }
    return matched ? total : 0;
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) {
        parts.push(`${d}d`);
    }
    if (h) {
        parts.push(`${h}h`);
    }
    if (m) {
        parts.push(`${m}m`);
    }
    parts.push(`${sec}s`);
    return parts.join(" ");
}

/**
 * Format a duration in milliseconds into a compact string (e.g. '2d 4h 30m').
 * Unlike formatUptime, this omits seconds for cleaner premium expiry display.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatExpiry(ms) {
    if (ms <= 0) {
        return "0m";
    }
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    const parts = [];
    if (days) {
        parts.push(`${days}d`);
    }
    if (hours) {
        parts.push(`${hours}h`);
    }
    if (mins) {
        parts.push(`${mins}m`);
    }
    return parts.join(" ") || "0m";
}

/**
 * @param {number} sec
 * @returns {string}
 */
export function formatDuration(sec) {
    if (!sec) {
        return "?";
    }
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec) % 60).padStart(2, "0")}`;
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatDurationMs(ms) {
    return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
}

/**
 * Format a Date as `YYYY-MM-DD HH:mm` in local time.
 * @param {Date|number} input
 * @returns {string}
 */
export function formatTimestamp(input) {
    const d = input instanceof Date ? input : new Date(input);
    const pad = (n) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
}

/**
 * @param {string} str
 * @returns {string}
 */
export function sanitizeFilename(str) {
    return (str || "").replace(/[\\/:*?"<>|]/g, "").slice(0, 60);
}

/**
 * Format a number into compact form (1K, 1.5M, etc).
 * @param {number} n
 * @returns {string}
 */
export function formatCount(n) {
    if (!n) {
        return "0";
    }
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1)}M`;
    }
    if (n >= 1_000) {
        return `${(n / 1_000).toFixed(1)}K`;
    }
    return String(n);
}
