import config from "#config";
import { GUARDS } from "./guards.js";

export { GuardError } from "./guards.js";

/**
 * @typedef {object} CommandDefinition
 * @property {string} name
 * @property {string[]} aliases
 * @property {string} description
 * @property {string|null} category - Set by the loader from folder name.
 * @property {Array<{ name: string, type: string, desc: string }>} options
 * @property {Function[]} guards
 * @property {Function} handler
 * @property {{ window: number, max: number }|null} rateLimit
 * @property {string|null} react
 * @property {boolean} disabled
 * @property {boolean} hidden
 * @property {string} cooldownMessage
 * @property {string} usage
 * @property {string} example
 * @property {string|null} prefix - Custom prefix override (e.g. ">>" for eval).
 * @property {string} note
 */

/**
 * Fluent builder for command definitions.
 *
 * @example
 *   new CommandBuilder()
 *     .setName("ping")
 *     .setDescription("Check bot latency")
 *     .setHandler(async (i) => i.reply("Pong!"));
 */
export class CommandBuilder {
    #def = {
        name: "",
        aliases: [],
        description: "",
        category: null,
        options: [],
        guards: [],
        handler: async () => {},
        rateLimit: null,
        react: null,
        disabled: false,
        hidden: false,
        cooldownMessage: "",
        usage: "",
        example: "",
        prefix: null,
        note: "",
    };

    setName(name) {
        this.#def.name = name.toLowerCase();
        return this;
    }

    setAliases(...aliases) {
        this.#def.aliases = aliases.flat().map((a) => a.toLowerCase());
        return this;
    }

    setDescription(text) {
        this.#def.description = text;
        return this;
    }

    setNote(text) {
        this.#def.note = text;
        return this;
    }

    /**
     * Add a positional option, accessible via `interaction.args[name]`.
     * @param {string} name
     * @param {string} [type="string"]
     * @param {string} [desc=""]
     */
    addOption(name, type = "string", desc = "") {
        this.#def.options.push({ name, type, desc });
        return this;
    }

    /**
     * Attach guards by name ("owner", "group", "admin") or by function.
     * Function guards must throw {@link GuardError} on failure.
     */
    setGuard(...guards) {
        for (const g of guards) {
            if (typeof g === "function") {
                this.#def.guards.push(g);
                continue;
            }
            if (!GUARDS[g]) {
                throw new Error(
                    `Unknown guard: "${g}". Available: ${Object.keys(GUARDS).join(", ")}`,
                );
            }
            this.#def.guards.push(GUARDS[g]);
        }
        return this;
    }

    setHandler(fn) {
        this.#def.handler = fn;
        return this;
    }

    setReact(emoji) {
        this.#def.react = emoji;
        return this;
    }

    setDisabled(v = true) {
        this.#def.disabled = v;
        return this;
    }

    /** Hide the command from `menu` listings. Still callable directly. */
    setHidden(v = true) {
        this.#def.hidden = v;
        return this;
    }

    /**
     * Limit invocations per user.
     * @param {number} ms - Time window in milliseconds.
     * @param {number} [max=3]
     */
    setRateLimit(ms, max = 3) {
        this.#def.rateLimit = { window: ms, max };
        return this;
    }

    setCooldownMessage(text) {
        this.#def.cooldownMessage = text;
        return this;
    }

    /** Usage template; supports `{prefix}` and `{name}` placeholders. */
    setUsage(text) {
        this.#def.usage = text;
        return this;
    }

    /** Example template; supports `{prefix}` and `{name}` placeholders. */
    setExample(text) {
        this.#def.example = text;
        return this;
    }

    /** Override the global prefix for this command (e.g. `">>"` for eval). */
    setPrefix(prefix) {
        this.#def.prefix = prefix;
        return this;
    }

    /** Finalize and return the command definition. */
    build() {
        const def = this.#def;
        if (!def.name) {
            throw new Error("Command name is required");
        }

        const prefix = def.prefix || config.prefixes[0] || "!";
        const fillTemplate = (t) =>
            t
                ? t
                      .replaceAll("{prefix}", prefix)
                      .replaceAll("{name}", def.name)
                : `${prefix}${def.name}`;

        return {
            ...def,
            usage: fillTemplate(def.usage),
            example: fillTemplate(def.example),
        };
    }
}
