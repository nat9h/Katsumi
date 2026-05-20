import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { makeGreetingHandler } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("welcome")
    .setDescription("Manage welcome message for this group")
    .setUsage("{prefix}{name} <on|off|set <text>|show>")
    .setExample("{prefix}welcome set Hi @{user} welcome to {group}")
    .setGuard("group", "admin")
    .setHandler(
        makeGreetingHandler({
            kind: "welcome",
            label: "Welcome",
            placeholders: "`{user}`, `{group}`, `{desc}`",
        }),
    );
