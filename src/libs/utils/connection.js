/**
 * @fileoverview Connection health monitor & resilience utilities.
 *
 * Provides:
 * - Silent disconnect detection (keep-alive watchdog)
 * - Connection quality metrics
 * - Graceful socket teardown helper
 * - Reconnection state machine helpers
 *
 * Zero RSS impact — uses only timers and event listeners, no data accumulation.
 *
 * @module utils/connection
 */

import { Boom } from "@hapi/boom";
import { DisconnectReason } from "baileys";
import logger, { print } from "./logger.js";

/**
 * Human-readable disconnect reason from a Baileys lastDisconnect error.
 *
 * @param {object} lastDisconnect
 * @returns {{ code: number, reason: string, shouldReconnect: boolean }}
 */
export function parseDisconnect(lastDisconnect) {
    const error = lastDisconnect?.error;
    const statusCode = error
        ? new Boom(error).output?.statusCode
        : DisconnectReason.connectionClosed;

    const reasons = {
        [DisconnectReason.loggedOut]: "Logged out",
        [DisconnectReason.badSession]: "Bad session (corrupted auth)",
        [DisconnectReason.connectionClosed]: "Connection closed",
        [DisconnectReason.connectionLost]: "Connection lost (network)",
        [DisconnectReason.connectionReplaced]:
            "Connection replaced (another device)",
        [DisconnectReason.timedOut]: "Timed out",
        [DisconnectReason.multideviceMismatch]: "Multi-device mismatch",
        [DisconnectReason.restartRequired]: "Restart required",
    };

    const noReconnect = [
        DisconnectReason.loggedOut,
        DisconnectReason.badSession,
        DisconnectReason.multideviceMismatch,
    ];

    return {
        code: statusCode,
        reason: reasons[statusCode] || `Unknown (${statusCode})`,
        shouldReconnect: !noReconnect.includes(statusCode),
    };
}

/**
 * Lightweight watchdog that detects silent disconnects.
 *
 * Baileys has a built-in keep-alive (ping every 30s), but if the WS
 * silently dies without emitting 'close', the bot hangs indefinitely.
 * This watchdog monitors event activity and triggers a forced reconnect
 * if no events arrive within the threshold.
 *
 * @example
 * const watchdog = createHealthMonitor(client, {
 *   silentTimeoutMs: 90_000,  // 90s without any event = dead
 *   onDead: () => client._connect()
 * });
 * // Call watchdog.destroy() on shutdown
 */
export function createHealthMonitor(client, options = {}) {
    const {
        silentTimeoutMs = 90_000,
        checkIntervalMs = 30_000,
        onDead = null,
    } = options;

    let lastActivity = Date.now();
    let timer = null;
    let destroyed = false;

    const touch = () => {
        lastActivity = Date.now();
    };

    const check = () => {
        if (destroyed) {
            return;
        }

        const sock = client.sock;
        if (!sock?.ws?.isOpen) {
            return;
        }

        const elapsed = Date.now() - lastActivity;
        if (elapsed > silentTimeoutMs) {
            print.warn(
                `Health monitor: no activity for ${(elapsed / 1000).toFixed(0)}s, connection may be dead`,
            );
            logger.warn(
                { elapsed, threshold: silentTimeoutMs },
                "silent disconnect detected",
            );

            if (onDead) {
                onDead();
            }
        }
    };

    const hookEvents = () => {
        const sock = client.sock;
        if (!sock?.ev) {
            return;
        }

        const proofOfLife = [
            "connection.update",
            "messages.upsert",
            "messages.update",
            "presence.update",
            "chats.update",
            "contacts.update",
            "groups.update",
            "group-participants.update",
            "call",
            "creds.update",
        ];

        for (const event of proofOfLife) {
            sock.ev.on(event, touch);
        }
    };

    hookEvents();
    timer = setInterval(check, checkIntervalMs);
    timer.unref?.();

    return {
        /** Manually signal activity (e.g., after sending a message). */
        touch,

        /** Current time since last activity in ms. */
        get elapsed() {
            return Date.now() - lastActivity;
        },

        /** Whether the connection appears healthy. */
        get isHealthy() {
            return (
                (client.sock?.ws?.isOpen ?? false) &&
                Date.now() - lastActivity < silentTimeoutMs
            );
        },

        /** Re-hook events after a reconnect (new socket instance). */
        rehook() {
            hookEvents();
            touch();
        },

        /** Clean up timers and listeners. */
        destroy() {
            destroyed = true;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
    };
}

/**
 * Cleanly tear down a Baileys socket instance.
 *
 * Baileys leaks timers and listeners if you just replace the socket reference.
 * This helper ensures everything is properly cleaned up before reconnecting.
 *
 * @param {import('baileys').WASocket|null} sock
 */
export function teardownSocket(sock) {
    if (!sock) {
        return;
    }

    try {
        sock.ev?.removeAllListeners();
    } catch {}

    try {
        if (sock.ws && !sock.ws.isClosed && !sock.ws.isClosing) {
            sock.ws.close();
        }
    } catch {}

    try {
        sock.end?.(undefined);
    } catch {}
}

/**
 * Calculate exponential backoff delay with jitter.
 *
 * @param {number} attempt - Current attempt number (0-based)
 * @param {{ baseMs?: number, maxMs?: number, jitterMs?: number }} [opts]
 * @returns {number} Delay in milliseconds
 */
export function backoffDelay(
    attempt,
    { baseMs = 1000, maxMs = 60_000, jitterMs = 1000 } = {},
) {
    const exp = Math.min(baseMs * 2 ** attempt, maxMs);
    const jitter = Math.floor(Math.random() * jitterMs);
    return exp + jitter;
}

/**
 * Determine if a disconnect error is recoverable.
 *
 * @param {object} lastDisconnect
 * @returns {boolean}
 */
export function isRecoverable(lastDisconnect) {
    return parseDisconnect(lastDisconnect).shouldReconnect;
}

/**
 * Simple connection uptime tracker.
 * Call start() on connection open, stop() on close.
 *
 * @returns {{ start: () => void, stop: () => void, uptimeMs: number, sessions: number }}
 */
export function createUptimeTracker() {
    let startTime = null;
    let totalUptime = 0;
    let sessions = 0;

    return {
        start() {
            startTime = Date.now();
            sessions++;
        },
        stop() {
            if (startTime) {
                totalUptime += Date.now() - startTime;
                startTime = null;
            }
        },
        /** Current session uptime in ms (0 if disconnected). */
        get currentMs() {
            return startTime ? Date.now() - startTime : 0;
        },
        /** Total accumulated uptime across all sessions. */
        get totalMs() {
            return totalUptime + (startTime ? Date.now() - startTime : 0);
        },
        /** Number of connection sessions. */
        get sessions() {
            return sessions;
        },
    };
}
