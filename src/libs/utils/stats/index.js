/**
 * @fileoverview Batched message statistics accumulator.
 * @module utils/stats
 */

export class StatsAccumulator {
    #db;
    #global;
    #groupCounts = new Map();
    #dirtyGroups = new Set();
    #dirtyGlobal = false;
    #timer;

    /**
     * @param {object} db
     * @param {{ flushMs?: number }} [opts]
     */
    constructor(db, { flushMs = 30_000 } = {}) {
        this.#db = db;
        this.#global = db.get("stats:messages") || {
            total: 0,
            today: 0,
            date: "",
        };
        this.#timer = setInterval(() => this.flush(), flushMs);
        this.#timer.unref?.();
    }

    bump() {
        const today = new Date().toISOString().slice(0, 10);
        if (this.#global.date !== today) {
            this.#global.today = 0;
            this.#global.date = today;
        }
        this.#global.total++;
        this.#global.today++;
        this.#dirtyGlobal = true;
    }

    /**
     * @param {string} groupJid
     * @param {string} userJid
     */
    bumpGroup(groupJid, userJid) {
        let counts = this.#groupCounts.get(groupJid);
        if (!counts) {
            counts = this.#db.get(`groupchat:${groupJid}`) || {};
            this.#groupCounts.set(groupJid, counts);
        }
        if (!counts.__since) {
            counts.__since = Date.now();
        }
        counts[userJid] = (counts[userJid] || 0) + 1;
        this.#dirtyGroups.add(groupJid);
    }

    /** @returns {{ total: number, today: number, date: string }} */
    getGlobal() {
        return { ...this.#global };
    }

    /**
     * @param {string} groupJid
     * @returns {Record<string, number>}
     */
    getGroup(groupJid) {
        return (
            this.#groupCounts.get(groupJid) ||
            this.#db.get(`groupchat:${groupJid}`) ||
            {}
        );
    }

    flush() {
        if (this.#dirtyGlobal) {
            this.#db.set("stats:messages", this.#global);
            this.#dirtyGlobal = false;
        }
        for (const jid of this.#dirtyGroups) {
            const counts = this.#groupCounts.get(jid);
            if (counts) {
                this.#db.set(`groupchat:${jid}`, counts);
            }
        }
        this.#dirtyGroups.clear();
    }

    destroy() {
        clearInterval(this.#timer);
        this.flush();
    }
}
