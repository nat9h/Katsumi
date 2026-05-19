import { extractText } from "#utils/message";

/**
 * Show a numbered list to the user, wait for them to reply with a number,
 * and resolve to the chosen item (or null on invalid/timeout).
 *
 * @template T
 * @param {object} cfg
 * @param {import('#structures/Interaction.js').Interaction} cfg.interaction
 * @param {T[]} cfg.items
 * @param {(item: T, index: number) => string} cfg.format - Render each item as a line.
 * @param {string|{ caption: string, image?: object|null }} cfg.header
 *        Caption sent before the list. Pass an object with `image` to render with thumbnail.
 * @param {number} [cfg.timeout=30_000]
 * @returns {Promise<T|null>}
 */
export async function selectFromList({
    interaction,
    items,
    format,
    header,
    timeout = 30_000,
}) {
    const lines = items.map((item, i) => format(item, i));
    const caption = typeof header === "string" ? header : header.caption;
    const body = `${caption}\n\n${lines.join("\n")}\n\n_Reply number._`;
    const image = typeof header === "object" ? header.image : null;

    await interaction.reply(image ? { image, caption: body } : body);

    try {
        const reply = await interaction.awaitReply(() => true, timeout);
        const num = Number.parseInt(extractText(reply.message).trim(), 10);

        if (!Number.isInteger(num) || num < 1 || num > items.length) {
            await interaction.followUp("Invalid selection.");
            return null;
        }
        return items[num - 1];
    } catch {
        await interaction.followUp("⏰ Timeout.");
        return null;
    }
}
