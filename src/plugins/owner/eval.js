import util from "node:util";

export default {
	name: "eval",
	description: "Execute JavaScript code.",
	command: ["=>", ">>"],
	permissions: "owner",
	hidden: false,
	failed: "Failed to execute %command: %error",
	category: "owner",
	cooldown: 0,
	usage: ">> <code> or => <code>",
	react: true,
	owner: true,
	wait: null,

	/**
	 * Executes the provided JavaScript code.
	 * @param {object} context - The context object.
	 * @param {import('baileys').WASocket} context.sock - The Baileys socket object.
	 * @param {object} context.m - The serialized message object.
	 * @param {string} context.text - The text content after the command.
	 * @param {string[]} context.args - Arguments of the command.
	 * @param {string} context.command - The actual command triggered (e.g., ">>" or "=>").
	 * @param {boolean} context.isOwner - Indicates if the sender is an owner.
	 */
	/* eslint-disable no-unused-vars */
	async execute(m, { text, command, db, store, groupMetadata, sock }) {
		/* eslint-enable no-unused-vars */
		if (!text) {
			await m.reply(
				"📚 Usage:\n`>> <code>` (direct eval)\n`=> <code>` (async IIFE eval)\nExample: `>> 2 + 2`"
			);
			return;
		}

		let result;
		try {
			if (command === "=>") {
				result = await eval(`(async () => {\n${text}\n})()`);
			} else {
				result = await eval(text);
			}

			if (typeof result !== "string") {
				result = util.inspect(result, { depth: null, colors: false });
			}

			const finalResult = result?.toString()?.trim() || undefined;

			await m.reply(finalResult);
		} catch (error) {
			await m.reply(
				`\`\`\`${error.stack || error.message || error}\n\`\`\``
			);
		}
	},
};
