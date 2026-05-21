/**
 * @fileoverview Message collector for awaiting user replies.
 * @module structures/Collector
 */

import { EventEmitter } from "node:events";
import { areJidsSameUser } from "baileys";
import config from "#config";

/**
 * @typedef {object} CollectorOptions
 * @property {number} [time=60000] - Timeout in milliseconds before auto-stop.
 * @property {number} [max=1] - Maximum messages to collect before auto-stop.
 */

/**
 * Collects incoming messages matching a filter and emits events.
 * Stops automatically after `max` messages or when `time` runs out.
 *
 * @extends EventEmitter
 */
export class Collector extends EventEmitter {
    /** @type {import('baileys').WASocket} */
    #sock;

    /** @type {string} */
    #chatJid;

    /** @type {string} */
    #userJid;

    /** @type {(msg: object) => boolean} */
    #filter;

    /** @type {number} */
    #max;

    /** @type {object[]} */
    #collected = [];

    /** @type {boolean} */
    #ended = false;

    /** @type {ReturnType<typeof setTimeout>|null} */
    #timeout = null;

    /** @type {Function} Bound event handler reference for cleanup. */
    #handler;

    /**
     * Create a new message collector.
     *
     * @param {import('baileys').WASocket} sock - The Baileys socket instance.
     * @param {string} chatJid - The chat JID to listen in.
     * @param {string} userJid - The user JID to filter messages from.
     * @param {(msg: object) => boolean} filter - Custom filter function.
     * @param {CollectorOptions} options - Collector configuration.
     */
    constructor(sock, chatJid, userJid, filter, { time = 60_000, max = 1 }) {
        super();
        this.#sock = sock;
        this.#chatJid = chatJid;
        this.#userJid = userJid;
        this.#filter = filter;
        this.#max = max;

        const ownIdPrefix = `${config.botId}_`;

        this.#handler = ({ type, messages }) => {
            if (type !== "notify") {
                return;
            }
            for (const msg of messages) {
                const msgId = msg.key.id ?? "";
                if (msg.key.fromMe && msgId.startsWith(ownIdPrefix)) {
                    continue;
                }
                if (msg.key.remoteJid !== this.#chatJid) {
                    continue;
                }

                const sender =
                    msg.key.participant ||
                    (msg.key.fromMe ? this.#sock.user?.id : msg.key.remoteJid);
                let sameUser = sender === this.#userJid;
                if (!sameUser) {
                    try {
                        sameUser = areJidsSameUser(sender, this.#userJid);
                    } catch {}
                }
                if (!sameUser) {
                    continue;
                }
                if (!this.#filter(msg)) {
                    continue;
                }

                this.#collected.push(msg);
                this.emit("collect", msg);

                if (this.#max && this.#collected.length >= this.#max) {
                    this.stop("max");
                }
            }
        };

        this.#sock.ev.on("messages.upsert", this.#handler);

        if (time) {
            this.#timeout = setTimeout(() => this.stop("time"), time);
        }
    }

    /**
     * Get all collected messages.
     * @returns {object[]}
     */
    get collected() {
        return this.#collected;
    }

    /**
     * Whether the collector has ended.
     * @returns {boolean}
     */
    get ended() {
        return this.#ended;
    }

    /**
     * Stop the collector and clean up listeners.
     * @param {string} [reason="manual"] - Reason for stopping ("time", "max", or "manual").
     */
    stop(reason = "manual") {
        if (this.#ended) {
            return;
        }
        this.#ended = true;
        clearTimeout(this.#timeout);
        this.#sock.ev.off("messages.upsert", this.#handler);
        this.emit("end", this.#collected, reason);
    }
}
