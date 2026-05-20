/**
 * @fileoverview Runtime infrastructure: LRU cache, async queue, and stats accumulator.
 * @module utils/runtime
 */

export class MemCache {
    #map = new Map();
    #ttl;
    #max;

    /**
     * @param {{ ttl?: number, max?: number }} [opts]
     */
    constructor({ ttl = 5 * 60_000, max = 500 } = {}) {
        this.#ttl = ttl;
        this.#max = max;
    }

    /**
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        const entry = this.#map.get(key);
        if (!entry) {
            return undefined;
        }
        if (Date.now() > entry.exp) {
            this.#map.delete(key);
            return undefined;
        }
        this.#map.delete(key);
        this.#map.set(key, entry);
        return entry.value;
    }

    /**
     * @param {string} key
     * @returns {*}
     */
    peek(key) {
        const entry = this.#map.get(key);
        if (!entry) {
            return undefined;
        }
        if (Date.now() > entry.exp) {
            this.#map.delete(key);
            return undefined;
        }
        return entry.value;
    }

    /**
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
        if (this.#map.has(key)) {
            this.#map.delete(key);
        } else if (this.#map.size >= this.#max) {
            this.#map.delete(this.#map.keys().next().value);
        }
        this.#map.set(key, { value, exp: Date.now() + this.#ttl });
    }

    /** @param {string} key */
    delete(key) {
        return this.#map.delete(key);
    }

    clear() {
        this.#map.clear();
    }

    /** @yields {[string, *]} */
    *entries() {
        const now = Date.now();
        for (const [k, v] of this.#map) {
            if (now <= v.exp) {
                yield [k, v.value];
            }
        }
    }

    get size() {
        return this.#map.size;
    }
}

/**
 * @template T
 * @typedef {object} QueueTask
 * @property {() => Promise<T>} fn
 * @property {(value: T) => void} resolve
 * @property {(reason: any) => void} reject
 */

export class Queue {
    #concurrency;
    #running = 0;
    #pending = [];

    /** @param {number} [concurrency=3] */
    constructor(concurrency = 3) {
        this.#concurrency = concurrency;
    }

    get pending() {
        return this.#pending.length;
    }

    get running() {
        return this.#running;
    }

    get size() {
        return this.#pending.length + this.#running;
    }

    /**
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    add(fn) {
        return new Promise((resolve, reject) => {
            this.#pending.push({ fn, resolve, reject });
            this.#next();
        });
    }

    #next() {
        if (this.#running >= this.#concurrency || !this.#pending.length) {
            return;
        }

        const { fn, resolve, reject } = this.#pending.shift();
        this.#running++;

        fn()
            .then(resolve)
            .catch(reject)
            .finally(() => {
                this.#running--;
                this.#next();
            });
    }
}

export const downloadQueue = new Queue(2);
export const mediaQueue = new Queue(2);
export const defaultQueue = new Queue(3);

export class QueueFullError extends Error {
    /**
     * @param {string} userId
     * @param {number} pending
     */
    constructor(userId, pending) {
        super(`Too many pending tasks for ${userId} (${pending})`);
        this.name = "QueueFullError";
        this.code = "QUEUE_FULL";
        this.userId = userId;
        this.pending = pending;
    }
}

/**
 * Serializes async tasks per user. Tasks for the same userId run one at
 * a time in FIFO order; tasks for different users run in parallel.
 *
 * Useful for keeping a single user from running multiple commands at
 * once (and from spamming commands while a slow one is still in flight).
 */
export class UserSerialQueue {
    /** @type {Map<string, { pending: number, tail: Promise<any> }>} */
    #entries = new Map();
    #maxPending;

    /** @param {{ maxPending?: number }} [opts] */
    constructor({ maxPending = 5 } = {}) {
        this.#maxPending = maxPending;
    }

    /**
     * Number of tasks (running + queued) for the given user.
     * @param {string} userId
     * @returns {number}
     */
    pending(userId) {
        return this.#entries.get(userId)?.pending ?? 0;
    }

    /**
     * @param {string} userId
     * @returns {boolean}
     */
    isBusy(userId) {
        return this.pending(userId) > 0;
    }

    /**
     * Push a task onto the user's queue. The returned promise resolves
     * with `fn`'s result, or rejects with `QueueFullError` if the user
     * already has `maxPending` tasks queued.
     *
     * @template T
     * @param {string} userId
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    add(userId, fn) {
        const existing = this.#entries.get(userId);
        if (existing && existing.pending >= this.#maxPending) {
            return Promise.reject(new QueueFullError(userId, existing.pending));
        }

        const entry = existing ?? { pending: 0, tail: Promise.resolve() };
        if (!existing) {
            this.#entries.set(userId, entry);
        }

        entry.pending++;
        const next = entry.tail.catch(() => {}).then(() => fn());
        entry.tail = next;

        next.finally(() => {
            entry.pending--;
            if (entry.pending === 0 && this.#entries.get(userId) === entry) {
                this.#entries.delete(userId);
            }
        });

        return next;
    }
}

export const userQueue = new UserSerialQueue({ maxPending: 5 });

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
