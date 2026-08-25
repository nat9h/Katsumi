/**
 * @fileoverview Tiny CLI-style flag parser tuned for chat-command input.
 *
 * Why not `node:util` parseArgs?
 * - parseArgs requires single-character short flags (e.g. `-v`), but our
 *   commands historically use multi-char short flags like `-wm`, `-qc`, `-d`.
 * - parseArgs needs a pre-tokenized array; the middleware only does a naive
 *   whitespace split so quoted values with spaces get shredded.
 *
 * This helper provides:
 *   1. `tokenize()`  — shell-aware split that respects `'…'` and `"…"`.
 *   2. `parseFlags()` — accepts a string or token array, supports both
 *      `--name`/`--name=value` and multi-char short `-name` forms,
 *      plus boolean / string / repeatable flags via a schema.
 *
 * @module utils/flags
 */

/**
 * Split a string into tokens, honoring single and double quotes and simple
 * backslash escapes inside double quotes.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function tokenize(input) {
    if (!input) {
        return [];
    }

    const tokens = [];
    let cur = "";
    let quote = null;
    let hasContent = false;

    for (let i = 0; i < input.length; i++) {
        const c = input[i];

        if (quote) {
            if (c === quote) {
                quote = null;
            } else if (c === "\\" && quote === '"' && i + 1 < input.length) {
                cur += input[++i];
            } else {
                cur += c;
            }
            continue;
        }

        if (c === "'" || c === '"') {
            quote = c;
            hasContent = true;
            continue;
        }

        if (/\s/.test(c)) {
            if (hasContent) {
                tokens.push(cur);
                cur = "";
                hasContent = false;
            }
            continue;
        }

        if (c === "\\" && i + 1 < input.length) {
            cur += input[++i];
        } else {
            cur += c;
        }
        hasContent = true;
    }

    if (hasContent) {
        tokens.push(cur);
    }
    return tokens;
}

/**
 * @typedef {Object} FlagDef
 * @property {"string"|"boolean"} type
 * @property {string} [alias]    - Single alternate name (e.g. `v` for `video`).
 * @property {boolean} [multiple] - Collect repeated occurrences into an array.
 * @property {*} [default]
 */

/**
 * Parse flags from a string or pre-tokenized array.
 *
 * Recognized forms:
 *   --flag          (boolean true)
 *   --flag=value
 *   --flag value
 *   -flag           (same as --flag; multi-char short OK)
 *   -flag=value
 *   -flag value
 *
 * Unknown tokens — including unknown `--foo` — are returned as positional
 * so existing regex-based parsing in commands keeps working unchanged.
 *
 * @param {string|string[]} input
 * @param {Record<string, FlagDef>} [schema]
 * @returns {{ flags: Record<string, any>, positional: string[] }}
 */
export function parseFlags(input, schema = {}) {
    const tokens = Array.isArray(input) ? input.slice() : tokenize(input);

    const aliasMap = Object.create(null);
    for (const [name, def] of Object.entries(schema)) {
        if (def.alias) {
            aliasMap[def.alias] = name;
        }
    }

    const flags = Object.create(null);
    const positional = [];

    for (const [name, def] of Object.entries(schema)) {
        if (def.default !== undefined) {
            flags[name] = def.default;
        } else if (def.multiple) {
            flags[name] = [];
        }
    }

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const m = t.match(/^(--?)([A-Za-z0-9][\w-]*)(?:=([\s\S]*))?$/);

        if (!m) {
            positional.push(t);
            continue;
        }

        const rawKey = m[2];
        const inline = m[3];
        const key = aliasMap[rawKey] ?? rawKey;
        const def = schema[key];

        if (!def) {
            positional.push(t);
            continue;
        }

        let value;
        if (def.type === "boolean") {
            value =
                inline === undefined
                    ? true
                    : !/^(false|0|no|off)$/i.test(inline);
        } else if (inline !== undefined) {
            value = inline;
        } else if (i + 1 < tokens.length) {
            value = tokens[++i];
        } else {
            value = "";
        }

        if (def.multiple) {
            (flags[key] ??= []).push(value);
        } else {
            flags[key] = value;
        }
    }

    return { flags, positional };
}
