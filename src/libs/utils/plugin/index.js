import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CommandBuilder } from "#structures/CommandBuilder";
import logger from "#utils/log/logger";
import { print } from "#utils/log/print";

const COMMANDS_DIR = join(process.cwd(), "src", "commands");

/** Resolved command lookup — primary names + aliases all point here. */
export const commandMap = new Map();

/** Walk one category folder, returning [filename, fileUrl] pairs. */
async function listCategory(category) {
    const dir = join(COMMANDS_DIR, category);
    try {
        const files = await readdir(dir);
        return files
            .filter((f) => f.endsWith(".js"))
            .map((f) => [f, pathToFileURL(join(dir, f)).href]);
    } catch {
        print.warn(`skipped category: ${category}`);
        return [];
    }
}

/** Coerce an imported plugin export into a built command definition. */
function resolveCommand(plugin) {
    if (plugin instanceof CommandBuilder) {
        return plugin.build();
    }
    if (plugin?.name && typeof plugin.handler === "function") {
        return plugin;
    }
    return null;
}

/** Register a command under its name and aliases. */
function register(cmd) {
    commandMap.set(cmd.name, cmd);
    for (const alias of cmd.aliases ?? []) {
        commandMap.set(alias, cmd);
    }
}

/** Load every command in `src/commands/<category>/*.js`. */
export async function loadPlugins({ bustCache = false } = {}) {
    let entries;
    try {
        entries = await readdir(COMMANDS_DIR, { withFileTypes: true });
    } catch (err) {
        logger.warn({ err }, `commands directory not found: ${COMMANDS_DIR}`);
        return { loaded: 0, failed: 0 };
    }

    const categories = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    let loaded = 0;
    let failed = 0;

    for (const category of categories) {
        for (const [file, url] of await listCategory(category)) {
            try {
                const mod = await import(
                    bustCache ? `${url}?v=${Date.now()}` : url
                );
                const cmd = resolveCommand(mod.default);

                if (!cmd) {
                    print.warn(`skipped ${file}: no valid export`);
                    continue;
                }

                cmd.category = category;
                register(cmd);
                if (!bustCache) {
                    print.cmdLoaded(cmd.name, category);
                }
                loaded++;
            } catch (err) {
                logger.error({ err }, `failed to load: ${file}`);
                print.error(`failed to load: ${file} — ${err.message}`);
                failed++;
            }
        }
    }

    print.cmdSummary(loaded, failed);
    return { loaded, failed };
}

/** Hot-reload: clear the map and re-import every plugin. */
export async function reloadPlugins() {
    commandMap.clear();
    return loadPlugins({ bustCache: true });
}
