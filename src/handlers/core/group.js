import logger from "#utils/log/logger";

const VALID_ACTIONS = new Set(["add", "remove", "leave"]);

const DEFAULT_TEMPLATES = {
    welcome: "👋 Welcome @{user} to *{group}*!\n\n{desc}",
    leave: "👋 Bye @{user}, see you again!",
};

/** Replace `{user}`, `{group}`, `{desc}` placeholders. */
function applyTemplate(template, { user, group, desc }) {
    return template
        .replaceAll("{user}", user)
        .replaceAll("{group}", group)
        .replaceAll("{desc}", desc);
}

/** Re-emit group metadata updates so plugins/listeners can react. */
export function handleGroupEvents(client, events) {
    client.emit("groupsUpdate", events);
}

/**
 * Send welcome/leave messages on participant changes. Templates and toggles
 * live in KV under `${kind}:${jid}` and `${kind}:${jid}:enabled`.
 *
 * Placeholders: `{user}`, `{group}`, `{desc}`.
 *
 * @param {import('../Client.js').Client} client
 * @param {{ id: string, action: string, participants: Array<string|object> }} event
 */
export async function handleParticipantsForWelcome(client, event) {
    const groupJid = event.id;
    if (!groupJid?.endsWith("@g.us")) {
        return;
    }
    if (!VALID_ACTIONS.has(event.action)) {
        return;
    }

    const kind = event.action === "add" ? "welcome" : "leave";
    if (!client.db.get(`${kind}:${groupJid}:enabled`)) {
        return;
    }

    const template =
        client.db.get(`${kind}:${groupJid}`) || DEFAULT_TEMPLATES[kind];

    let meta;
    try {
        meta = await client.sock.groupMetadata(groupJid);
        client.groupCache.set(groupJid, meta);
    } catch (err) {
        logger.warn({ err }, "welcome: failed to fetch group metadata");
        return;
    }

    const participants = (event.participants || [])
        .map((p) => (typeof p === "string" ? p : p.id || p.jid))
        .filter(Boolean);

    for (const jid of participants) {
        const text = applyTemplate(template, {
            user: jid.split("@")[0] || "user",
            group: meta.subject || "",
            desc: meta.desc || "",
        });

        await client
            .sendMessage(groupJid, { text, mentions: [jid] })
            .catch(() => {});
    }
}
