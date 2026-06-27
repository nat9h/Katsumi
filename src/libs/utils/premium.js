const KEY = "premium_users";

/** @returns {Record<string, number>} */
function getAll(db) {
    return db.get(KEY) || {};
}

function saveAll(db, data) {
    db.set(KEY, data);
}

/**
 * Add or extend a user's premium subscription.
 * @param {object} db - Key-Value store instance
 * @param {string} jid - User JID
 * @param {number} durationMs - Duration in milliseconds
 */
export function addPremium(db, jid, durationMs) {
    const data = getAll(db);
    const currentExpiry = data[jid] || 0;
    const baseTime = Math.max(Date.now(), currentExpiry);
    data[jid] = baseTime + durationMs;
    saveAll(db, data);
}

/** @param {string} jid */
export function removePremium(db, jid) {
    const data = getAll(db);
    delete data[jid];
    saveAll(db, data);
}

/** @returns {boolean} */
export function isPremium(db, jid) {
    const data = getAll(db);
    const expiry = data[jid];
    if (!expiry) {
        return false;
    }

    if (Date.now() > expiry) {
        removePremium(db, jid);
        return false;
    }
    return true;
}

/** @returns {number} expiry timestamp or 0 */
export function getExpiry(db, jid) {
    const data = getAll(db);
    return data[jid] || 0;
}

/** @returns {Array<{jid: string, expiry: number}>} */
export function listPremium(db) {
    const data = getAll(db);
    const now = Date.now();
    const active = [];
    const toRemove = [];

    for (const [jid, expiry] of Object.entries(data)) {
        if (now > expiry) {
            toRemove.push(jid);
        } else {
            active.push({ jid, expiry });
        }
    }

    if (toRemove.length) {
        for (const jid of toRemove) {
            delete data[jid];
        }
        saveAll(db, data);
    }

    return active;
}
