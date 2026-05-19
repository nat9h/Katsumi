import { Boom } from "@hapi/boom";
import { DisconnectReason } from "baileys";
import QRCode from "qrcode-terminal";
import config from "#config";
import { state } from "#state";
import logger from "#utils/log/logger";
import { print } from "#utils/log/print";

const MAX_RECONNECT_DELAY_MS = 60_000;
const DM_WARMUP_LIMIT = 50;

/** Try to resolve LIDs for all configured owner numbers. Best-effort. */
async function resolveOwnerLids(sock) {
    const ownerJids = config.ownerJids;
    if (!ownerJids.length) {
        return;
    }

    for (const ownerJid of ownerJids) {
        const ownerNumber = ownerJid.split("@")[0];
        if (!ownerNumber) {
            continue;
        }

        if (state.ownerLids.includes(ownerJid)) {
            continue;
        }

        try {
            const [result] = (await sock.onWhatsApp(ownerNumber)) ?? [];
            if (!result?.jid) {
                continue;
            }

            const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(
                result.jid,
            );
            if (lid) {
                state.addOwnerLid(lid);
                print.info(`Owner LID resolved: ${ownerNumber} → ${lid}`);
            }
        } catch (err) {
            print.warn(
                `Owner LID resolve failed for ${ownerNumber}: ${err.message}`,
            );
        }
    }
}

/** Pre-fill the ephemeral cache for a sample of DM chats on startup. */
async function warmEphemeralForDMs(client) {
    const dmJids = (client.store.getAllChats?.() ?? [])
        .map((c) => c.id)
        .filter((j) => j?.endsWith("@s.whatsapp.net"))
        .slice(0, DM_WARMUP_LIMIT);

    if (!dmJids.length) {
        return;
    }

    const result = await client.sock.fetchDisappearingDuration?.(...dmJids);
    if (!Array.isArray(result)) {
        return;
    }

    for (const r of result) {
        const dur = r?.disappearingMode?.duration || r?.duration || 0;
        if (r?.id && dur > 0) {
            client.ephemeralCache.set(r.id, dur);
        }
    }
}

function schedulePairingCode(client) {
    setTimeout(async () => {
        try {
            const code = await client.sock.requestPairingCode(
                config.pairingNumber,
            );
            print.pairingCode(code);
            client.emit("pairingCode", code);
        } catch (err) {
            print.error(`Pairing code request failed: ${err.message}`);
            logger.error({ err }, "pairing code request failed");
        }
    }, config.pairingDelay);
}

function backoffDelay(attempt) {
    const exp = Math.min(
        config.initialReconnectDelay * 2 ** attempt,
        MAX_RECONNECT_DELAY_MS,
    );
    return exp + Math.floor(Math.random() * 1000);
}

function scheduleReconnect(client, lastDisconnect) {
    const statusCode = lastDisconnect?.error
        ? new Boom(lastDisconnect.error).output?.statusCode
        : undefined;

    if (statusCode === DisconnectReason.loggedOut) {
        print.error("Logged out – re-authentication required");
        client.emit("loggedOut");
        return;
    }

    if (client.reconnectAttempts >= config.maxReconnectAttempts) {
        print.fatal("Max reconnection attempts reached – exiting");
        process.exit(1);
    }

    const delay = backoffDelay(client.reconnectAttempts);
    client.reconnectAttempts++;
    print.warn(
        `Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${client.reconnectAttempts})`,
    );
    setTimeout(() => client._connect(), delay);
}

function onConnectionOpen(client) {
    client.reconnectAttempts = 0;
    const jid = client.sock.user?.id ?? "";
    print.ready(jid, config.botId);

    resolveOwnerLids(client.sock).catch(() => {});
    client.syncGroupMetadata().catch(() => {});
    warmEphemeralForDMs(client).catch(() => {});
    import("#services/clone/connect")
        .then((m) => m.restoreClones(client))
        .catch(() => {});

    client.emit("ready");
}

/**
 * Handle Baileys connection.update events: QR display, pairing code
 * request, open, and close/reconnect.
 *
 * @param {import('../Client.js').Client} client
 * @param {object} update
 */
export async function handleConnectionUpdate(client, update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr && config.loginMethod === "qr") {
        QRCode.generate(qr, { small: true });
        client.emit("qr", qr);
    }

    const needsPairing =
        connection === "connecting" &&
        config.loginMethod === "pairing" &&
        config.pairingNumber &&
        !client.sock.authState.creds.registered;
    if (needsPairing) {
        schedulePairingCode(client);
    }

    if (connection === "open") {
        onConnectionOpen(client);
    }
    if (connection === "close" && !client._shuttingDown) {
        scheduleReconnect(client, lastDisconnect);
    }
}
