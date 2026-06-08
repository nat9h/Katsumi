import { commandMap } from "#libs/utils/plugin";

/** Categories visible only to the bot owner. */
const OWNER_CATEGORIES = new Set(["owner"]);

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const byName = (a, b) => a.name.localeCompare(b.name);
const cmdLine = (p, c) =>
    `• \`${p}${c.name}\`${c.description ? ` — ${c.description}` : ""}`;

/** Whether a command should appear in listings for the given viewer. */
export function isVisible(cmd, viewerIsOwner) {
    if (cmd.disabled || cmd.hidden) {
        return false;
    }
    return viewerIsOwner || !OWNER_CATEGORIES.has(cmd.category);
}

/** Group visible commands by category, deduplicated by name. */
export function groupCommands(viewerIsOwner) {
    const seen = new Set();
    const groups = {};

    for (const [, cmd] of commandMap) {
        if (seen.has(cmd.name) || !isVisible(cmd, viewerIsOwner)) {
            continue;
        }
        seen.add(cmd.name);
        (groups[cmd.category || "misc"] ??= []).push(cmd);
    }
    return groups;
}

/** Detail view for a single command. */
export function renderCommandDetail(prefix, cmd) {
    const replacePfx = (s) =>
        s
            .replace(/\{prefix\}/g, prefix)
            .replace(/\{name\}/g, cmd.name)
            .replace(/^[!.?]/gm, prefix);

    const usage = replacePfx(cmd.usage);
    const example = replacePfx(cmd.example);

    const exampleLines = example.split("\n");
    const exampleFormatted =
        exampleLines.length > 1
            ? `\n${exampleLines.map((l) => `  \`${l.trim()}\``).join("\n")}`
            : `\`${example}\``;

    const lines = [
        `📖 *${prefix}${cmd.name}*`,
        "",
        cmd.description || "_No description_",
        "",
        `• Usage: \`${usage}\``,
        `• Example: ${exampleFormatted}`,
    ];

    if (cmd.aliases?.length) {
        const aliases = cmd.aliases.map((a) => `\`${prefix}${a}\``).join(", ");
        lines.push(`• Aliases: ${aliases}`);
    }
    if (cmd.note) {
        lines.push(`• Note: ${replacePfx(cmd.note)}`);
    }

    return lines.join("\n");
}

/** Single category listing. */
export function renderCategory(prefix, category, cmds) {
    const lines = [`📂 *${titleCase(category)}*`, ""];
    for (const cmd of cmds.sort(byName)) {
        lines.push(cmdLine(prefix, cmd));
    }
    return lines.join("\n");
}

/** Full menu, grouped by category. */
export function renderFullMenu(prefix, cmdName, userJid, groups) {
    const lines = [`Hi @${userJid.split("@")[0]}!`];

    for (const [cat, cmds] of Object.entries(groups).sort()) {
        lines.push("", `✦ *${titleCase(cat)}*`);
        for (const cmd of cmds.sort(byName)) {
            lines.push(cmdLine(prefix, cmd));
        }
    }

    lines.push(
        "",
        `_Type \`${prefix}${cmdName} <command|category>\` for details._`,
    );
    return lines.join("\n");
}
