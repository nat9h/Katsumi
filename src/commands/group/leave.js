import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { makeGreetingHandler } from "#libs/utils/interaction";

export default new CommandBuilder()
    .setName("leave")
    .setAliases("goodbye", "bye")
    .setDescription("Manage leave message for this group")
    .setUsage("{prefix}{name} <on|off|set <text>|show>")
    .setExample("{prefix}leave set Bye @{user} 👋")
    .setGuard("group", "admin")
    .setHandler(
        makeGreetingHandler({
            kind: "leave",
            label: "Leave",
            placeholders: "`{user}`, `{group}`",
        }),
    );
