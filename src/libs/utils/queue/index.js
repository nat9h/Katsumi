/**
 * @fileoverview Async task queue with concurrency control.
 * @module utils/queue
 */

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
