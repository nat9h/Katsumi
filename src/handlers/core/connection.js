import QRCode from "qrcode-terminal";
import config from "#config";
import { backoffDelay, parseDisconnect } from "#libs/utils/connection";
import logger, { print } from "#libs/utils/logger";
import { state } from "#state";

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
        .slice(0, 50);

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

/**
 * Request a pairing code once, on the first `connecting` of an unregistered
 * session.
 *
 * Guarded because every reconnect emits `connecting` again, and a second
 * request overwrites `creds.pairingCode` — invalidating the code the user is
 * still typing into their phone. The flag is only cleared when the request
 * itself did not go through.
 */
function schedulePairingCode(client) {
    if (client._pairingRequested) {
        return;
    }
    client._pairingRequested = true;

    setTimeout(async () => {
        if (
            !client.sock?.ws?.isOpen ||
            client.sock.authState.creds.registered
        ) {
            client._pairingRequested = false;
            return;
        }

        try {
            const code = await client.sock.requestPairingCode(
                config.pairingNumber,
            );
            print.pairingCode(code);
            client.emit("pairingCode", code);
        } catch (err) {
            client._pairingRequested = false;
            print.error(`Pairing code request failed: ${err.message}`);
            logger.error({ err }, "pairing code request failed");
        }
    }, config.pairingDelay);
}

function scheduleReconnect(client, lastDisconnect) {
    const { code, reason, shouldReconnect } = parseDisconnect(lastDisconnect);

    if (!shouldReconnect) {
        print.error(`${reason} – re-authentication required`);
        client.emit("loggedOut", code);
        return;
    }

    if (client.reconnectAttempts >= config.maxReconnectAttempts) {
        print.fatal("Max reconnection attempts reached – exiting");
        process.exit(1);
    }

    const delay = backoffDelay(client.reconnectAttempts, {
        baseMs: config.initialReconnectDelay,
    });
    client.reconnectAttempts++;
    print.warn(
        `Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${client.reconnectAttempts})`,
    );
    setTimeout(() => client._connect(), delay);
}

function onConnectionOpen(client) {
    client.reconnectAttempts = 0;
    client.uptime.start();
    const jid = client.sock.user?.id ?? "";
    print.ready(jid, config.botId);

    resolveOwnerLids(client.sock).catch(() => {});
    client.syncGroupMetadata().catch(() => {});
    warmEphemeralForDMs(client).catch(() => {});
    import("#libs/services/clone/connect")
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
