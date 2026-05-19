/**
 * @fileoverview In-memory LRU cache with TTL and max capacity.
 * @module utils/cache
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
