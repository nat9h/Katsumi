import { jidNormalizedUser } from "baileys";
import { convertAudio } from "#libs/utils/converter/audio";
import logger from "#libs/utils/logger";
import {
    extractText,
    extractUrl,
    findContextInfo,
    unwrapMessage,
} from "#libs/utils/message";
import { Collector } from "./Collector.js";

/**
 * @typedef {import('baileys').WASocket} WASocket
 * @typedef {import('baileys').proto.IWebMessageInfo} WAMessage
 * @typedef {import('../../handlers/Client.js').Client} Client
 */

const DEFAULT_AWAIT_MS = 30_000;

/**
 * Per-message context passed to every command handler.
 *
 * Wraps a raw Baileys message and provides helpers for replying, reacting,
 * collecting follow-up messages, and resolving WA-specific quirks like
 * ephemeral expiration and LID/PN JID normalization.
 */
export class Interaction {
    /** @type {Client} */ client;
    /** @type {WASocket} */ sock;
    store;
    db;
    /** @type {WAMessage} */ msg;

    prefix = "";
    commandName = "";
    /** @type {Record<string, string|null>} */ args = {};
    /** @type {string[]} */ rawArgs = [];
    body = "";
    rawBody = "";

    /**
     * When true, every reply/followUp will include ephemeralExpiration
     * mirrored from the incoming message. Set by the middleware pipeline
     * after a command is matched.
     */
    autoEphemeral = false;

    _replied = false;
    _lastMsg = null;

    /** @type {number|undefined} */
    #ephemeralCached;
    #typingTimer = null;

    /**
     * @param {Client} client
     * @param {WAMessage} msg
     */
    constructor(client, msg) {
        this.client = client;
        this.sock = client.sock;
        this.store = client.store;
        this.db = client.db;
        this.msg = msg;
    }

    /**
     * Normalized JID of the message sender.
     * In groups this is the participant JID; in DMs it's remoteJid.
     * @returns {string}
     */
    get user() {
        const k = this.msg.key;
        const raw =
            k.participant ||
            (k.fromMe ? this.sock.user?.id : k.remoteJid) ||
            k.remoteJid;
        try {
            return jidNormalizedUser(raw) || raw;
        } catch {
            return raw;
        }
    }

    /** @returns {string} */
    get userName() {
        return this.msg.pushName || "Unknown";
    }

    /** @returns {boolean} */
    get isGroup() {
        return this.msg.key.remoteJid.endsWith("@g.us");
    }

    /** @returns {string} */
    get chatJid() {
        return this.msg.key.remoteJid;
    }

    /** @returns {boolean} */
    get fromMe() {
        return this.msg.key.fromMe === true;
    }

    /** @returns {string} */
    get msgId() {
        return this.msg.key.id ?? "";
    }

    /** Plain text of the message, unwrapping ephemeral/viewOnce containers. */
    get text() {
        return extractText(this.msg.message);
    }

    /**
     * First URL found in the message text, or null.
     * @returns {string|null}
     */
    get url() {
        return extractUrl(this.text);
    }

    /**
     * True if the message text contains a URL.
     * @returns {boolean}
     */
    get isUrl() {
        return !!this.url;
    }

    /** @returns {string[]} */
    get mentions() {
        return findContextInfo(this.msg.message)?.mentionedJid || [];
    }

    /**
     * The quoted/replied-to message, or null if there isn't one.
     *
     * @returns {{ message: object, sender: string, stanzaId: string, mentionedJid: string[], text: string, url: string|null, isUrl: boolean }|null}
     */
    get quoted() {
        const ctx = findContextInfo(this.msg.message);
        if (!ctx?.quotedMessage) {
            return null;
        }

        const message = unwrapMessage(ctx.quotedMessage) || ctx.quotedMessage;
        const text = extractText(message);
        const url = extractUrl(text);
        return {
            message,
            sender: ctx.participant || "",
            stanzaId: ctx.stanzaId || "",
            mentionedJid: ctx.mentionedJid || [],
            text,
            url,
            isUrl: !!url,
        };
    }

    /**
     * Fetch group metadata, preferring the in-memory cache then the store
     * before hitting the network.
     *
     * @returns {Promise<object|null>}
     */
    async getGroupMeta() {
        if (!this.isGroup) {
            return null;
        }
        const jid = this.chatJid;

        const cached = this.client.groupCache.get(jid);
        if (cached?.participants?.length) {
            return cached;
        }

        const stored = this.store.getGroup(jid);
        if (stored?.participants?.length) {
            this.client.groupCache.set(jid, stored);
            return stored;
        }

        try {
            const meta = await this.sock.groupMetadata(jid);
            this.client.groupCache.set(jid, meta);
            this.store.upsertGroup(meta);
            return meta;
        } catch {
            return stored || null;
        }
    }

    /**
     * Ephemeral expiration (seconds) for this chat, or 0 if not disappearing.
     *
     * Resolution order:
     * 1. `_expiration` on synthetic edit messages (set by the message handler)
     * 2. `contextInfo.expiration` inside the ephemeralMessage wrapper
     * 3. `contextInfo.expiration` directly on message content fields
     * 4. ephemeralCache fallback (covers edits where the wrapper was stripped)
     *
     * @returns {number}
     */
    get expiration() {
        if (this.#ephemeralCached !== undefined) {
            return this.#ephemeralCached;
        }

        if (this.msg._expiration > 0) {
            this.#ephemeralCached = this.msg._expiration;
            return this.#ephemeralCached;
        }

        const message = this.msg.message;
        if (!message) {
            this.#ephemeralCached =
                this.client.ephemeralCache?.get(this.chatJid) || 0;
            return this.#ephemeralCached;
        }

        const inner = message.ephemeralMessage?.message;
        if (inner) {
            for (const v of Object.values(inner)) {
                if (v && typeof v === "object") {
                    const exp = Number(v.contextInfo?.expiration);
                    if (exp > 0) {
                        this.#ephemeralCached = exp;
                        return exp;
                    }
                }
            }
        }

        for (const v of Object.values(message)) {
            if (v && typeof v === "object" && !Array.isArray(v)) {
                const exp = Number(v.contextInfo?.expiration);
                if (exp > 0) {
                    this.#ephemeralCached = exp;
                    return exp;
                }
            }
        }

        const cached = this.client.ephemeralCache?.get(this.chatJid) || 0;
        this.#ephemeralCached = cached;
        return cached;
    }

    async typing() {
        try {
            await this.sock.sendPresenceUpdate("composing", this.chatJid);
        } catch {}
        clearTimeout(this.#typingTimer);
        this.#typingTimer = setTimeout(
            () => this.stopTyping().catch(() => {}),
            8_000,
        );
    }

    async stopTyping() {
        clearTimeout(this.#typingTimer);
        this.#typingTimer = null;
        try {
            await this.sock.sendPresenceUpdate("paused", this.chatJid);
        } catch {}
    }

    /**
     * Build the base sendMessage options: a fresh message ID, the quoted
     * message reference, and ephemeralExpiration if the chat is disappearing.
     *
     * @param {number} [extraEphemeral] - Override expiration (seconds).
     * @returns {Promise<object>}
     */
    async #baseOptions(extraEphemeral) {
        const opts = {
            messageId: this.client.generateMsgId(),
            quoted: this.msg,
        };

        const expiration =
            extraEphemeral || (this.autoEphemeral ? this.expiration : 0);

        if (expiration > 0) {
            opts.ephemeralExpiration = expiration;
        }

        return opts;
    }

    /**
     * Normalize content before sending. Converts strings to `{ text }`,
     * handles PTT audio conversion, and strips any stray ephemeralExpiration
     * that might have been set on the content object directly.
     *
     * @param {string|object} content
     * @returns {Promise<object>}
     */
    async #normalizeContent(content) {
        if (typeof content === "string") {
            return { text: content };
        }

        if (content.audio && Buffer.isBuffer(content.audio) && content.ptt) {
            try {
                content.audio = await convertAudio(content.audio);
                content.mimetype = "audio/ogg; codecs=opus";
            } catch (err) {
                logger.error(err, "audio conversion failed");
            }
        }

        const { ephemeralExpiration: _drop, ...rest } = content;
        return rest;
    }

    /**
     * @param {object} content
     * @param {object} options
     * @returns {Promise<object>}
     */
    async #send(content, options) {
        return this.client.sendMessage(this.chatJid, content, options);
    }

    /**
     * Send a reply to the triggering message. Subsequent calls are
     * automatically routed to `followUp` so the first reply is always
     * a direct quote.
     *
     * @param {string|object} content
     * @param {{ ephemeralExpiration?: number }} [opts]
     * @returns {Promise<object>}
     */
    async reply(content, { ephemeralExpiration } = {}) {
        if (this._replied) {
            return this.followUp(content, { ephemeralExpiration });
        }

        const opts = await this.#baseOptions(ephemeralExpiration);
        const message = await this.#normalizeContent(content);
        const sent = await this.#send(message, opts);

        this._replied = true;
        this._lastMsg = sent;
        this.stopTyping().catch(() => {});
        return sent;
    }

    /**
     * Send a follow-up message quoting the last sent message.
     *
     * @param {string|object} content
     * @param {{ ephemeralExpiration?: number }} [opts]
     * @returns {Promise<object>}
     */
    async followUp(content, { ephemeralExpiration } = {}) {
        const opts = await this.#baseOptions(ephemeralExpiration);
        if (this._lastMsg?.key) {
            opts.quoted = this._lastMsg;
        }

        const message = await this.#normalizeContent(content);
        const sent = await this.#send(message, opts);
        this._lastMsg = sent;
        return sent;
    }

    /**
     * Edit the last message the bot sent in this interaction.
     *
     * @param {string} text
     * @returns {Promise<object>}
     */
    async editReply(text) {
        if (!this._lastMsg) {
            throw new Error("Nothing to edit");
        }

        const opts = await this.#baseOptions();
        delete opts.quoted;

        const sent = await this.#send({ edit: this._lastMsg.key, text }, opts);
        this._lastMsg = sent;
        return sent;
    }

    /**
     * Send a reaction emoji to the triggering message.
     *
     * @param {string} emoji
     * @returns {Promise<object>}
     */
    async react(emoji) {
        return this.sock.sendMessage(this.chatJid, {
            react: { text: emoji, key: this.msg.key },
        });
    }

    /**
     * Send a poll message.
     *
     * @param {string} name - Poll question
     * @param {string[]} options - Answer choices
     * @param {{ selectableCount?: number, isAnonymous?: boolean }} [opts]
     * @returns {Promise<object>}
     */
    async sendPoll(
        name,
        options,
        { selectableCount = 1, isAnonymous = true } = {},
    ) {
        return this.#send(
            {
                poll: {
                    name,
                    options: options.map((optionName) => ({ optionName })),
                    selectableOptionsCount: selectableCount,
                    isAnonymous,
                },
            },
            await this.#baseOptions(),
        );
    }

    /**
     * Create a message collector scoped to this chat and user.
     *
     * @param {{ filter?: Function, time?: number, max?: number }} [opts]
     * @returns {Collector}
     */
    createMessageCollector({
        filter = () => true,
        time = 60_000,
        max = 1,
    } = {}) {
        return new Collector(this.sock, this.chatJid, this.user, filter, {
            time,
            max,
        });
    }

    /**
     * Wait for a single reply from the same user in the same chat.
     *
     * @param {Function} [filter]
     * @param {number} [time]
     * @returns {Promise<object>}
     */
    awaitReply(filter = () => true, time = DEFAULT_AWAIT_MS) {
        return new Promise((resolve, reject) => {
            const collector = this.createMessageCollector({
                filter,
                time,
                max: 1,
            });

            collector.on("collect", (msg) => {
                collector.stop();
                this._lastMsg = msg;
                resolve(msg);
            });

            collector.on("end", (_, reason) => {
                if (reason === "time") {
                    reject(new Error("Timeout"));
                }
            });
        });
    }

    /**
     * Show a numbered list and wait for the user to pick one.
     * Returns the selected item or null on invalid input / timeout.
     *
     * @param {object[]} items - Must have `subject` or `id` property
     * @param {string} title
     * @returns {Promise<object|null>}
     */
    async pickFromList(items, title) {
        const lines = items.map((it, i) => `${i + 1}. ${it.subject || it.id}`);
        await this.reply(
            `📋 *${title}:*\n\n${lines.join("\n")}\n\n_Reply with number._`,
        );

        try {
            const reply = await this.awaitReply(() => true, DEFAULT_AWAIT_MS);
            const num = Number.parseInt(extractText(reply.message).trim(), 10);

            if (!Number.isInteger(num) || num < 1 || num > items.length) {
                await this.followUp("Invalid. Cancelled.");
                return null;
            }
            return items[num - 1];
        } catch {
            await this.followUp("⏰ Timeout.");
            return null;
        }
    }
}
