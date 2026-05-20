/**
 * @fileoverview Logging: pino logger instance + centralized console output.
 * @module utils/logger
 */

import pino from "pino";
import config from "#config";

/** @type {import('pino').Logger} */
const logger = pino({ level: config.logLevel });
export default logger;

/** ANSI color escape codes. */
const C = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    blue: "\x1b[34m",
    gray: "\x1b[90m",
    white: "\x1b[97m",
    magenta: "\x1b[35m",
};

/** Message type to emoji icon mapping. */
const TYPE_ICON = {
    conversation: "💬",
    extendedTextMessage: "💬",
    imageMessage: "🖼 ",
    videoMessage: "🎬",
    ptvMessage: "🔵",
    audioMessage: "🎵",
    documentMessage: "📄",
    stickerMessage: "🎭",
    locationMessage: "📍",
    contactMessage: "👤",
    contactsArrayMessage: "👥",
    pollCreationMessage: "📊",
    reactionMessage: "⚡",
    viewOnceMessageV2: "👁 ",
    protocolMessage: "⚙ ",
    liveLocationMessage: "📡",
    listMessage: "📋",
    buttonsMessage: "🔘",
    orderMessage: "🛒",
    invoiceMessage: "🧾",
};

/**
 * Get a formatted timestamp string (HH:MM:SS).
 * @returns {string}
 */
function ts() {
    return `${C.gray}${new Date().toLocaleTimeString("en-GB", { hour12: false })}${C.reset}`;
}

/**
 * Extract the number portion from a JID.
 * @param {string} [jid=""]
 * @returns {string}
 */
function shortJid(jid = "") {
    return jid.split("@")[0];
}

/**
 * Determine the primary message type key (skipping messageContextInfo).
 * @param {object} [message={}]
 * @returns {string}
 */
function msgType(message = {}) {
    return (
        Object.keys(message).find((k) => k !== "messageContextInfo") ??
        "unknown"
    );
}

/**
 * Extract preview text from a message object.
 * @param {object} [message={}]
 * @returns {string}
 */
function msgText(message = {}) {
    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        ""
    );
}

/**
 * Write a line to stdout.
 * @param {string} line
 */
function out(line) {
    process.stdout.write(`${line}\n`);
}

/**
 * Centralized print utility for all human-visible console output.
 */
export const print = {
    /**
     * Print an informational message.
     * @param {string} text - The message text.
     */
    info(text) {
        out(`${ts()}  ${C.cyan}ℹ${C.reset}  ${text}`);
    },

    /**
     * Print a success message.
     * @param {string} text - The message text.
     */
    ok(text) {
        out(`${ts()}  ${C.green}✔${C.reset}  ${text}`);
    },

    /**
     * Print a warning message.
     * @param {string} text - The message text.
     */
    warn(text) {
        out(`${ts()}  ${C.yellow}⚠${C.reset}  ${text}`);
    },

    /**
     * Print an error message.
     * @param {string} text - The message text.
     */
    error(text) {
        out(`${ts()}  ${C.red}✖${C.reset}  ${text}`);
    },

    /**
     * Print a fatal error message with bold formatting.
     * @param {string} text - The message text.
     */
    fatal(text) {
        out(`${ts()}  ${C.red}${C.bold}✖ FATAL${C.reset}  ${text}`);
    },

    /**
     * Display the pairing code prominently in the console.
     * @param {string} code - The pairing code to display.
     */
    pairingCode(code) {
        out("");
        out(`${ts()}  🔑  Pairing code: ${C.bold}${C.yellow}${code}${C.reset}`);
        out("");
    },

    /**
     * Display the bot-ready banner with JID and bot ID.
     * @param {string} jid - The bot's WhatsApp JID.
     * @param {string} botId - The configured bot identifier.
     */
    ready(jid, botId) {
        const num = shortJid(jid);
        out("");
        out(`  ${C.green}${C.bold}● Bot online${C.reset}`);
        out(`  ${C.dim}number${C.reset}  ${C.white}${num}${C.reset}`);
        out(`  ${C.dim}bot id${C.reset}  ${C.magenta}${botId}${C.reset}`);
        out("");
    },

    /**
     * Log an incoming or outgoing message.
     * @param {object} msg - The raw Baileys message object.
     * @param {boolean} [fromMe=false]
     * @param {object|null} [store=null]
     */
    message(msg, fromMe = false, store = null) {
        const jid = msg.key.remoteJid ?? "";
        const sender = msg.key.participant ?? msg.key.remoteJid ?? "";
        const msgId = msg.key.id ?? "";
        const name = msg.pushName || shortJid(sender);
        const type = msgType(msg.message);
        const icon = TYPE_ICON[type] ?? "📨";
        const text = msgText(msg.message);
        const isGroup = jid.endsWith("@g.us");

        const groupName =
            isGroup && store
                ? (store.getGroup(jid)?.subject ?? shortJid(jid))
                : shortJid(jid);

        const chatLabel = isGroup
            ? `${C.cyan}grp${C.reset} ${C.white}${groupName}${C.reset}`
            : `${C.green} dm${C.reset} ${C.dim}${shortJid(jid)}${C.reset}`;

        const selfTag = fromMe ? ` ${C.yellow}[self]${C.reset}` : "";
        const preview = text
            ? `  ${C.dim}›${C.reset} ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`
            : "";
        const idTag = `${C.gray}[${msgId.slice(0, 12)}]${C.reset}`;

        out(
            `${ts()}  ${icon}  ${chatLabel}${selfTag}  ${C.dim}${name}${C.reset}${preview}  ${idTag}`,
        );
    },

    /**
     * Log a successfully loaded command during startup.
     * @param {string} name - The command name.
     * @param {string} category - The command category folder.
     */
    cmdLoaded(name, category) {
        out(
            `${ts()}  ${C.dim}cmd${C.reset}  ${C.white}${name}${C.reset} ${C.dim}[${category}]${C.reset}`,
        );
    },

    /**
     * Print the command loading summary.
     * @param {number} loaded
     * @param {number} failed
     */
    cmdSummary(loaded, failed) {
        const ok = `${C.green}${loaded} loaded${C.reset}`;
        const bad = failed ? `  ${C.red}${failed} failed${C.reset}` : "";
        out(`${ts()}  📦  commands: ${ok}${bad}`);
    },
};
