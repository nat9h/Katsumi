/**
 * @fileoverview Warmup utility — sends an empty reaction to "warm up" the
 * connection before processing a command. The empty text reaction doesn't
 * show up in chat but triggers the WA protocol handshake, reducing latency
 * on the actual response.
 *
 * Only fires once per chat within a cooldown window (default 5 minutes),
 * so high-traffic groups don't get spammed with warmup requests.
 *
 * Inspired by: https://github.com/hllstr/sora-rs
 * @module libs/utils/warmup
 */

import { print } from "#libs/utils/logger";
import { state } from "#state";

/** Delay (ms) after sending warmup before continuing with command processing. */
const WARMUP_DELAY = 300;

/** Cooldown per chat (ms) — warmup won't fire again in the same chat within this window. */
const COOLDOWN = 5 * 60_000; // 5 minutes

/** Track last warmup time per chat JID. */
const lastWarmup = new Map();

// Cleanup stale entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [jid, ts] of lastWarmup) {
        if (now - ts > COOLDOWN) {
            lastWarmup.delete(jid);
        }
    }
}, 10 * 60_000).unref();

/**
 * Send a warmup (empty reaction) to the incoming message.
 * Only fires when the warmup toggle is enabled and the chat hasn't been
 * warmed up recently.
 *
 * @param {object} sock - Baileys socket instance
 * @param {object} msg - The incoming message object
 * @returns {Promise<void>}
 */
export async function sendWarmup(sock, msg) {
    if (!state.warmup) {
        return;
    }

    const chatJid = msg.key.remoteJid;
    if (!chatJid) {
        return;
    }

    // Skip if this chat was already warmed up recently
    const last = lastWarmup.get(chatJid);
    if (last && Date.now() - last < COOLDOWN) {
        return;
    }

    try {
        const start = Date.now();

        await sock.sendMessage(chatJid, {
            react: { text: "", key: msg.key },
        });

        const elapsed = Date.now() - start;
        lastWarmup.set(chatJid, Date.now());

        print.info(`[warmup] sent to ${chatJid.split("@")[0]} (${elapsed}ms)`);

        await new Promise((resolve) => setTimeout(resolve, WARMUP_DELAY));
    } catch (err) {
        print.warn(`[warmup] failed: ${err.message}`);
    }
}
