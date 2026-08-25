import { randomBytes } from "node:crypto";
import {
    generateWAMessageFromContent,
    jidNormalizedUser,
    proto,
} from "baileys";
import { convertAudio } from "#libs/utils/converter/audio";
import { parseFlags } from "#libs/utils/flags";
import logger from "#libs/utils/logger";
import {
    extractExpiration,
    extractText,
    extractUrl,
    findContextInfo,
    unwrapMessage,
} from "#libs/utils/message";
import { isPremium } from "#libs/utils/premium";
import { Collector } from "./Collector.js";
import { fillTemplate } from "./CommandBuilder.js";

/**
 * @typedef {import('baileys').WASocket} WASocket
 * @typedef {import('baileys').proto.IWebMessageInfo} WAMessage
 * @typedef {import('../../handlers/Client.js').Client} Client
 */

const DEFAULT_AWAIT_MS = 30_000;

/**
 * Parse a list selection into 1-based indices, in the order given, deduped
 * and clamped to `max`.
 *
 * Single mode ignores everything but a lone integer, so a stray "1,2" is
 * rejected rather than silently taking the first entry.
 *
 * @param {string} text
 * @param {number} max
 * @param {boolean} [multi]
 * @returns {number[]}
 */
export function parseSelection(text, max, multi = false) {
    const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= max;

    if (!multi) {
        const num = Number.parseInt(text, 10);
        return inRange(num) && String(num) === text.trim() ? [num] : [];
    }

    const indices = new Set();
    for (const part of text.split(",")) {
        const trimmed = part.trim();
        const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
        if (range) {
            const start = Number.parseInt(range[1], 10);
            const end = Number.parseInt(range[2], 10);
            for (let i = start; i <= end; i++) {
                indices.add(i);
            }
        } else {
            const num = Number.parseInt(trimmed, 10);
            if (!Number.isNaN(num)) {
                indices.add(num);
            }
        }
    }

    return [...indices].filter(inRange);
}

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
    /** @type {import('./CommandBuilder.js').CommandDefinition|null} */
    command = null;
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

    #ctxCached;
    #ctxComputed = false;
    #textCached;
    #textComputed = false;
    #quotedCached;
    #quotedComputed = false;
    #mentionsCached;
    #urlCached;
    #urlComputed = false;

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

    /** @returns {object|null} cached contextInfo of the current message */
    #getCtx() {
        if (this.#ctxComputed) {
            return this.#ctxCached;
        }
        this.#ctxComputed = true;
        this.#ctxCached = findContextInfo(this.msg.message) || null;
        return this.#ctxCached;
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

    /**
     * True if the message is a status update reshared into / originating from
     * a group context (proto.ContextInfo.isGroupStatus).
     * @returns {boolean}
     */
    get isGroupStatus() {
        return this.#getCtx()?.isGroupStatus === true;
    }

    /** @returns {boolean} */
    get fromMe() {
        return this.msg.key.fromMe === true;
    }

    /** @returns {boolean} */
    get isPremium() {
        return isPremium(this.db, this.user);
    }

    /** @returns {string} */
    get msgId() {
        return this.msg.key.id ?? "";
    }

    /** Plain text of the message, unwrapping ephemeral/viewOnce containers. */
    get text() {
        if (this.#textComputed) {
            return this.#textCached;
        }
        this.#textComputed = true;
        this.#textCached = extractText(this.msg.message);
        return this.#textCached;
    }

    /**
     * First URL found in the message text, or null.
     * @returns {string|null}
     */
    get url() {
        if (this.#urlComputed) {
            return this.#urlCached;
        }
        this.#urlComputed = true;
        this.#urlCached = extractUrl(this.text);
        return this.#urlCached;
    }

    /**
     * The URL-ish argument for this invocation, checked in the order users
     * actually supply one: typed inline, then quoted message.
     *
     * @param {string} [text] - Source text; pass the positional remainder
     *   when the command parses flags, so `--gif` isn't mistaken for input.
     * @returns {string} Empty string when nothing was supplied.
     */
    urlArg(text = this.body) {
        return (
            extractUrl(text) ||
            text ||
            this.quoted?.url ||
            this.quoted?.text ||
            ""
        ).trim();
    }

    /**
     * The command's usage line, rendered with the prefix that invoked it.
     *
     * @param {string} [extra=""] - Appended on its own line after the usage.
     * @returns {string}
     */
    usage(extra = "") {
        const line = fillTemplate(
            this.command?.usage,
            this.prefix,
            this.commandName,
        );
        return `Usage: \`${line}\`${extra ? `\n${extra}` : ""}`;
    }

    /**
     * The command's example line, rendered with the prefix that invoked it.
     * Multi-line examples are indented so they read as a list.
     *
     * @returns {string}
     */
    example() {
        const filled = fillTemplate(
            this.command?.example,
            this.prefix,
            this.commandName,
        );
        const lines = filled.split("\n");
        return lines.length > 1
            ? `Example:\n${lines.map((l) => `  \`${l.trim()}\``).join("\n")}`
            : `Example: \`${filled}\``;
    }

    /**
     * True if the message text contains a URL.
     * @returns {boolean}
     */
    get isUrl() {
        return !!this.url;
    }

    /**
     * Parse `rawBody` (preserves quoted whitespace) against a flag schema.
     *
     * Supports both `--flag value` and multi-char short `-flag value` forms,
     * plus boolean/string/repeatable flags. Unknown tokens fall through to
     * `positional` so existing regex parsing in commands remains valid.
     *
     * @param {Record<string, import('../utils/flags.js').FlagDef>} [schema]
     * @returns {{ flags: Record<string, any>, positional: string[] }}
     */
    parseFlags(schema = {}) {
        return parseFlags(this.rawBody, schema);
    }

    /** @returns {string[]} */
    get mentions() {
        if (this.#mentionsCached !== undefined) {
            return this.#mentionsCached;
        }
        this.#mentionsCached = this.#getCtx()?.mentionedJid || [];
        return this.#mentionsCached;
    }

    /**
     * The quoted/replied-to message, or null if there isn't one.
     *
     * @returns {{ message: object, sender: string, stanzaId: string, mentionedJid: string[], text: string, url: string|null, isUrl: boolean }|null}
     */
    get quoted() {
        if (this.#quotedComputed) {
            return this.#quotedCached;
        }
        this.#quotedComputed = true;

        const ctx = this.#getCtx();
        if (!ctx?.quotedMessage) {
            this.#quotedCached = null;
            return null;
        }

        const message = unwrapMessage(ctx.quotedMessage) || ctx.quotedMessage;
        const text = extractText(message);
        const url = extractUrl(text);
        this.#quotedCached = {
            message,
            sender: ctx.participant || "",
            stanzaId: ctx.stanzaId || "",
            mentionedJid: ctx.mentionedJid || [],
            text,
            url,
            isUrl: !!url,
        };
        return this.#quotedCached;
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

        this.#ephemeralCached =
            extractExpiration(this.msg.message) ||
            this.client.ephemeralCache?.get(this.chatJid) ||
            0;
        return this.#ephemeralCached;
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
     * @returns {object}
     */
    #baseOptions(extraEphemeral) {
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
     * Build, relay, and cache a raw proto message — for message types Baileys'
     * `sendMessage` cannot construct.
     *
     * @param {object} content - A `proto.Message`
     * @param {{ expiration?: number, quoted?: object, additionalNodes?: object[] }} [opts]
     * @returns {Promise<object>}
     */
    async #relay(content, { expiration = 0, quoted, additionalNodes } = {}) {
        const generated = await generateWAMessageFromContent(
            this.chatJid,
            content,
            {
                userJid: this.sock.user?.id,
                messageId: this.client.generateMsgId(),
                ...(quoted ? { quoted } : {}),
                ...(expiration > 0 ? { ephemeralExpiration: expiration } : {}),
            },
        );

        await this.sock.relayMessage(this.chatJid, generated.message, {
            messageId: generated.key.id,
            ...(additionalNodes ? { additionalNodes } : {}),
        });

        if (generated.key?.id) {
            this.client.messageCache.set(
                `${this.chatJid}_${generated.key.id}`,
                generated.message,
            );
        }

        this._replied = true;
        this._lastMsg = generated;
        this.stopTyping().catch(() => {});
        return generated;
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

        const opts = this.#baseOptions(ephemeralExpiration);
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
        const opts = this.#baseOptions(ephemeralExpiration);
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

        const opts = this.#baseOptions();
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
     * @param {string[]} values - Answer choices (plain strings)
     * @param {{ selectableCount?: number }} [opts]
     * @returns {Promise<object>}
     */
    async sendPoll(name, values, { selectableCount = 1 } = {}) {
        return this.#send(
            {
                poll: {
                    name,
                    values,
                    selectableCount,
                },
            },
            this.#baseOptions(),
        );
    }

    /**
     * Send multiple images/videos as an album (grouped media).
     * Uses Baileys native album support with albumParentKey.
     *
     * @param {Array<{ url?: string, buffer?: Buffer, type?: 'image'|'video' }>} items
     *   Each item should have either `url` or `buffer`, and optionally `type` (defaults to 'image').
     * @param {{ caption?: string, ephemeralExpiration?: number }} [opts]
     * @returns {Promise<object>} The album parent message
     */
    async sendAlbum(items, { caption = "", ephemeralExpiration } = {}) {
        if (!items?.length) {
            throw new Error("sendAlbum requires at least 1 item.");
        }

        const expiration =
            ephemeralExpiration || (this.autoEphemeral ? this.expiration : 0);

        const imageCount = items.filter(
            (i) => (i.type || "image") === "image",
        ).length;
        const videoCount = items.filter((i) => i.type === "video").length;

        const baseOpts = { messageId: this.client.generateMsgId() };
        if (expiration > 0) {
            baseOpts.ephemeralExpiration = expiration;
        }

        const albumMsg = await this.sock.sendMessage(
            this.chatJid,
            {
                album: {
                    expectedImageCount: imageCount,
                    expectedVideoCount: videoCount,
                },
            },
            baseOpts,
        );

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const type = item.type || "image";
            const media = item.buffer || { url: item.url };

            const content =
                type === "video" ? { video: media } : { image: media };

            if (i === 0 && caption) {
                content.caption = caption;
            }

            const itemOpts = { messageId: this.client.generateMsgId() };
            if (expiration > 0) {
                itemOpts.ephemeralExpiration = expiration;
            }

            await this.sock.sendMessage(
                this.chatJid,
                { ...content, albumParentKey: albumMsg.key },
                itemOpts,
            );
        }

        this._replied = true;
        this._lastMsg = albumMsg;
        this.stopTyping().catch(() => {});
        return albumMsg;
    }

    /**
     * Send a quiz poll (single-select with a correct answer).
     *
     * Uses pollCreationMessageV5 + Message.PollType.QUIZ so the WhatsApp client
     * highlights the correct answer after voting. Each option needs a hash for
     * vote-encryption to keep working when WA dispatches PollUpdateMessage.
     *
     * @param {string} name - Quiz question
     * @param {string[]} options - Answer choices
     * @param {number} correctIndex - 0-based index of the correct answer
     * @param {{ ephemeralExpiration?: number }} [opts]
     * @returns {Promise<object>}
     */
    async sendQuiz(name, options, correctIndex, { ephemeralExpiration } = {}) {
        if (!Array.isArray(options) || options.length < 2) {
            throw new Error("Quiz requires at least 2 options.");
        }
        if (
            !Number.isInteger(correctIndex) ||
            correctIndex < 0 ||
            correctIndex >= options.length
        ) {
            throw new Error(
                `correctIndex must be 0..${options.length - 1}, got ${correctIndex}`,
            );
        }

        const expiration =
            ephemeralExpiration || (this.autoEphemeral ? this.expiration : 0);

        const messageSecret = randomBytes(32);
        const builtOptions = options.map((optionName) => ({
            optionName: String(optionName),
        }));

        const pollCreation = {
            name,
            options: builtOptions,
            selectableOptionsCount: 1,
            pollContentType: proto.Message.PollContentType.TEXT,
            pollType: proto.Message.PollType.QUIZ,
            correctAnswer: builtOptions[correctIndex],
        };

        const content = proto.Message.fromObject({
            messageContextInfo: { messageSecret },
            pollCreationMessageV5: pollCreation,
        });

        return this.#relay(content, {
            expiration,
            quoted: this.msg,
            additionalNodes: [
                {
                    tag: "meta",
                    attrs: { contenttype: "text", polltype: "creation" },
                },
            ],
        });
    }

    /**
     * Create and send a NATIVE StickerPackMessage (the real "Lihat paket stiker" bubble).
     *
     * This uses the same approach as Baileys PR #1561:
     * - Converts stickers to WebP, ZIPs them (native, no external deps)
     * - Encrypts + uploads the ZIP archive
     * - Builds a proper stickerPackMessage proto
     *
     * @param {Buffer[]} stickerBuffers - Array of image/sticker buffers
     * @param {{ name?: string, publisher?: string, description?: string, cover?: Buffer, ephemeralExpiration?: number }} [opts]
     * @returns {Promise<object>}
     */
    async createNativeStickerPack(
        stickerBuffers,
        { name, publisher, description, cover, ephemeralExpiration } = {},
    ) {
        const { buildStickerPackMessage } = await import(
            "#libs/utils/converter/stickerpack"
        );

        const stickers = stickerBuffers.map((buf) => ({ data: buf }));

        const coverBuf = cover || stickerBuffers[0];

        const msgContent = await buildStickerPackMessage(
            {
                stickers,
                cover: coverBuf,
                name: name || "@natsumiworld",
                publisher: publisher || "",
                description: description || "",
            },
            this.sock,
        );

        return this.#relay(proto.Message.fromObject(msgContent), {
            expiration:
                ephemeralExpiration ||
                (this.autoEphemeral ? this.expiration : 0),
        });
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
        return new Collector(this.client, this.chatJid, this.user, filter, {
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
     * Show a numbered list and wait for the user to pick from it.
     *
     * Single mode accepts one number. Multi mode accepts "1,2,3", "1-5",
     * "1,3-5" or "all"/"*".
     *
     * @param {object[]} items - Must have `subject` or `id` property
     * @param {string} title
     * @param {{ multi?: boolean }} [opts]
     * @returns {Promise<object|object[]|null>} Array when `multi`, single item
     *   otherwise; null on invalid input or timeout.
     */
    async pickFromList(items, title, { multi = false } = {}) {
        const lines = items.map((it, i) => `${i + 1}. ${it.subject || it.id}`);
        const hint = multi
            ? "_Reply with numbers (e.g. 1,2,3 or 1-5 or all)._"
            : "_Reply with number._";
        const sentMsg = await this.reply(
            `📋 *${title}:*\n\n${lines.join("\n")}\n\n${hint}`,
        );
        const targetMsgId = sentMsg?.key?.id;

        let text;
        try {
            const reply = await this.awaitReply((msg) => {
                if (!targetMsgId) {
                    return true;
                }
                return findContextInfo(msg.message)?.stanzaId === targetMsgId;
            }, DEFAULT_AWAIT_MS);
            text = extractText(reply.message).trim().toLowerCase();
        } catch {
            await this.followUp("⏰ Timeout.");
            return null;
        }

        if (multi && (text === "all" || text === "*")) {
            return items.slice();
        }

        const picked = parseSelection(text, items.length, multi);
        if (!picked.length) {
            await this.followUp("Invalid. Cancelled.");
            return null;
        }

        const selected = picked.map((n) => items[n - 1]);
        return multi ? selected : selected[0];
    }
}
