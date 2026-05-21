import { EventEmitter } from "node:events";
import makeWASocket, {
    Browsers,
    fetchLatestBaileysVersion,
    generateMessageIDV2,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    proto,
} from "baileys";
import config from "#config";
import { createAuthStore, createDataStore, createKeyValueStore } from "#db";
import { handleConnectionUpdate } from "#handlers/core/connection";
import {
    handleGroupEvents,
    handleParticipantsForWelcome,
} from "#handlers/core/group";
import { handleMessagesUpsert } from "#handlers/core/message";
import logger, { print } from "#libs/utils/logger";
import { loadPlugins, reloadPlugins } from "#libs/utils/plugin";
import { MemCache, StatsAccumulator } from "#libs/utils/runtime";
import { state } from "#state";

/**
 * Main WhatsApp client. Owns the Baileys socket, persistent stores, in-memory
 * caches, stats, and graceful shutdown wiring.
 */
export class Client extends EventEmitter {
    sock = null;
    reconnectAttempts = 0;
    _shuttingDown = false;

    #pluginsLoaded = false;
    #reminderTimer;
    #msgIdPrefix = `${config.botId}_`;

    constructor() {
        super();

        this.authStore = createAuthStore();
        this.db = createKeyValueStore();
        this.store = createDataStore();

        this.groupCache = new MemCache({ ttl: 5 * 60_000, max: 300 });
        this.ephemeralCache = new MemCache({ ttl: 60 * 60_000, max: 1000 });
        // The message cache is only used for retrying decryption of recently
        // sent messages; a smaller window keeps RSS predictable.
        this.messageCache = new MemCache({ ttl: 15 * 60_000, max: 1500 });

        state.init(this.db);
        this.stats = new StatsAccumulator(this.db, { flushMs: 30_000 });

        this.#reminderTimer = setInterval(
            () => this.#processReminders(),
            30_000,
        );
        this.#reminderTimer.unref?.();

        this.#installShutdownHandlers();
    }

    /** Load plugins once, then connect. */
    async start() {
        if (!this.#pluginsLoaded) {
            await loadPlugins();
            this.#pluginsLoaded = true;
        }
        await this._connect();
    }

    /** Hot-reload all command plugins without restarting. */
    reloadPlugins() {
        return reloadPlugins();
    }

    /**
     * Generate a message ID prefixed with the bot's instance ID.
     * Used to identify messages the bot sent so we can skip our own echoes.
     */
    generateMsgId() {
        return this.#msgIdPrefix + generateMessageIDV2(this.sock?.user?.id);
    }

    /** Send a message and cache it for retry decryption. */
    async sendMessage(jid, content, options) {
        const sent = await this.sock.sendMessage(jid, content, options);
        if (sent?.key?.id) {
            this.messageCache.set(`${jid}_${sent.key.id}`, sent.message);
        }
        return sent;
    }

    /** Fetch and cache metadata for all groups the bot is in. */
    async syncGroupMetadata() {
        try {
            await new Promise((r) => setTimeout(r, 3_000));
            const groups = await this.sock.groupFetchAllParticipating();
            for (const [jid, meta] of Object.entries(groups)) {
                this.#cacheGroup(jid, meta);
            }
            print.info(`Synced ${Object.keys(groups).length} groups`);
        } catch (err) {
            print.warn(
                `groupFetchAllParticipating failed: ${err.message}, falling back...`,
            );
            for (const g of this.store.getAllGroups()) {
                try {
                    const meta = await this.sock.groupMetadata(g.id);
                    this.#cacheGroup(g.id, meta);
                } catch (e) {
                    print.warn(`Failed to sync group ${g.id}: ${e.message}`);
                }
            }
        }
    }

    /** Write group metadata to the group cache, message cache, and store. */
    #cacheGroup(jid, meta) {
        this.groupCache.set(jid, meta);
        this.store.upsertGroup(meta);
        if (meta.ephemeralDuration) {
            this.ephemeralCache.set(jid, meta.ephemeralDuration);
        }
    }

    /** Look up a previously sent message by chat + id, for decryption retries. */
    #getCachedMessage(remoteJid, id) {
        return this.messageCache.peek(`${remoteJid}_${id}`);
    }

    /** Fire any reminders that are due and remove them from the store. */
    async #processReminders() {
        if (!this.sock?.user) {
            return;
        }

        const list = this.db.get("reminders") || [];
        if (!list.length) {
            return;
        }

        const now = Date.now();
        const remaining = [];

        for (const r of list) {
            if (r.due > now) {
                remaining.push(r);
                continue;
            }
            try {
                await this.sendMessage(r.jid, {
                    text: `⏰ *Reminder for* @${r.user.split("@")[0]}\n${r.text}`,
                    mentions: [r.user],
                });
            } catch {
                return;
            }
        }

        if (remaining.length !== list.length) {
            this.db.set("reminders", remaining);
        }
    }

    async _connect() {
        const { version } = await fetchLatestBaileysVersion();

        // Tear down any previous socket before replacing it. removeAllListeners
        // alone leaves the underlying WebSocket / keep-alive timers alive,
        // which slowly grows RSS across reconnects.
        const prev = this.sock;
        if (prev) {
            try {
                prev.ev.removeAllListeners();
            } catch {}
            try {
                prev.ws?.close?.();
            } catch {}
            try {
                prev.end?.(undefined);
            } catch {}
        }

        this.sock = makeWASocket({
            version,
            auth: {
                creds: this.authStore.creds,
                keys: makeCacheableSignalKeyStore(this.authStore.keys, logger),
            },
            browser: Browsers.macOS("Safari"),
            printQRInTerminal: false,
            logger,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            cachedGroupMetadata: (jid) => this.#resolveGroup(jid),
            getMessage: async (key) =>
                this.#getCachedMessage(key.remoteJid, key.id) ||
                proto.Message.fromObject({}),
        });

        this.#registerEvents();
    }

    async #resolveGroup(jid) {
        const cached = this.groupCache.get(jid);
        if (cached?.participants?.length) {
            return cached;
        }

        const stored = this.store.getGroup(jid);
        if (stored?.participants?.length) {
            this.groupCache.set(jid, stored);
            return stored;
        }
        return undefined;
    }

    #registerEvents() {
        const { sock } = this;

        sock.ev.on("connection.update", (u) => handleConnectionUpdate(this, u));
        sock.ev.on("creds.update", () => this.authStore.saveCreds());

        sock.ev.on("messages.upsert", (m) => handleMessagesUpsert(this, m));
        sock.ev.on("messages.update", (u) => this.#onMessagesUpdate(u));
        sock.ev.on("messages.delete", (d) => this.emit("messageDelete", d));
        sock.ev.on("messages.reaction", (r) => this.emit("messageReaction", r));

        sock.ev.on("contacts.upsert", (c) => this.#upsertContacts(c));
        sock.ev.on("contacts.update", (c) => this.#upsertContacts(c));

        sock.ev.on("chats.upsert", (chats) => {
            for (const c of chats) {
                this.store.upsertChat(c);
            }
        });
        sock.ev.on("chats.update", (chats) => {
            for (const c of chats) {
                this.store.upsertChat(c);
                if (c.id && "ephemeralExpiration" in c) {
                    const exp = c.ephemeralExpiration || 0;
                    if (exp > 0) {
                        this.ephemeralCache.set(c.id, exp);
                    } else {
                        this.ephemeralCache.delete(c.id);
                    }
                }
            }
        });
        sock.ev.on("chats.delete", (ids) => {
            for (const id of ids) {
                this.store.deleteChat(id);
            }
        });

        sock.ev.on("groups.upsert", (g) => this.#onGroupsUpsert(g));
        sock.ev.on("groups.update", (u) => this.#onGroupsUpdate(u));
        sock.ev.on("group-participants.update", (e) =>
            this.#onParticipantsUpdate(e),
        );
        sock.ev.on("group.join-request", (e) =>
            this.emit("groupJoinRequest", e),
        );

        sock.ev.on("lid-mapping.update", (m) => this.#onLidMapping(m));
        sock.ev.on("call", (calls) => this.#onCall(calls));
    }

    #upsertContacts(contacts) {
        for (const c of contacts) {
            this.store.upsertContact(c);
        }
    }

    async #onGroupsUpsert(groups) {
        for (const g of groups) {
            try {
                const meta = await this.sock.groupMetadata(g.id);
                this.groupCache.set(g.id, meta);
                this.store.upsertGroup(meta);
            } catch {
                this.store.upsertGroup(g);
            }
        }
    }

    #onGroupsUpdate(updates) {
        handleGroupEvents(this, updates);
        for (const g of updates) {
            this.groupCache.delete(g.id);
            this.store.upsertGroup(g);

            if (typeof g.ephemeralDuration !== "number") {
                continue;
            }
            if (g.ephemeralDuration > 0) {
                this.ephemeralCache.set(g.id, g.ephemeralDuration);
            } else {
                this.ephemeralCache.delete(g.id);
            }
        }
    }

    async #onParticipantsUpdate(event) {
        const botJid = jidNormalizedUser(this.sock.user?.id || "");
        const botKicked =
            botJid &&
            (event.action === "remove" || event.action === "leave") &&
            event.participants?.some((p) => {
                try {
                    const id = typeof p === "string" ? p : p?.id || p?.jid;
                    return jidNormalizedUser(id) === botJid;
                } catch {
                    return false;
                }
            });

        if (botKicked) {
            this.groupCache.delete(event.id);
            this.store.deleteGroup(event.id);
            this.emit("groupParticipantsUpdate", event);
            return;
        }

        try {
            const meta = await this.sock.groupMetadata(event.id);
            this.groupCache.set(event.id, meta);
            this.store.upsertGroup(meta);
        } catch {
            this.groupCache.delete(event.id);
        }

        handleParticipantsForWelcome(this, event).catch(() => {});
        this.emit("groupParticipantsUpdate", event);
    }

    #onMessagesUpdate(updates) {
        for (const u of updates) {
            if (!u.pollUpdates) {
                continue;
            }
            this.emit("pollUpdate", {
                key: u.key,
                pollUpdates: u.pollUpdates,
                remoteJid: u.key.remoteJid,
            });
        }
    }

    #onLidMapping(mapping) {
        try {
            if (!mapping?.pn || !mapping?.lid) {
                return;
            }
            const ownerJids = config.ownerJids;
            if (ownerJids.includes(mapping.pn)) {
                state.addOwnerLid(mapping.lid);
                print.info(
                    `Owner LID resolved (live): ${mapping.pn.split("@")[0]} → ${mapping.lid}`,
                );
            }
        } catch {}
        this.emit("lidMappingUpdate", mapping);
    }

    async #onCall(calls) {
        this.emit("call", calls);
        if (!state.antiCall) {
            return;
        }

        for (const c of calls) {
            if (c.status !== "offer") {
                continue;
            }
            try {
                await this.sock.rejectCall(c.id, c.from);

                const ephemeral = this.ephemeralCache.get(c.from) || 0;
                const opts =
                    ephemeral > 0
                        ? { ephemeralExpiration: ephemeral }
                        : undefined;
                await this.sendMessage(
                    c.from,
                    {
                        text: "🚫 Sorry, I don't accept calls. Please send a message instead.",
                    },
                    opts,
                ).catch(() => {});
            } catch (err) {
                logger.warn({ err }, "anti-call reject failed");
            }
        }
    }

    #installShutdownHandlers() {
        const shutdown = async (signal) => {
            if (this._shuttingDown) {
                return;
            }
            this._shuttingDown = true;
            print.warn(`Shutting down (${signal})…`);

            try {
                this.stats?.destroy();
            } catch {}
            try {
                clearInterval(this.#reminderTimer);
            } catch {}
            try {
                await this.sock?.end?.(undefined);
            } catch {}

            await new Promise((r) => setTimeout(r, 300));
            process.exit(0);
        };

        process.once("SIGINT", () => shutdown("SIGINT"));
        process.once("SIGTERM", () => shutdown("SIGTERM"));
    }
}
