import GptService from "#lib/scrapers/gptservice";

export default {
	name: "gpt",
	description: "Chat with AI (DeepSeek Models).",
	command: ["ai", "gpt"],
	permissions: "all",
	hidden: false,
	failed: "Failed to execute %command: %error",
	wait: null,
	category: "ai",
	cooldown: 5,
	limit: false,
	usage: "$prefix$command <text>",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	/**
	 * @param {import("../../lib/serialize").default} m
	 * @param {{ sock: import("baileys").WASocket }}
	 */
	execute: async (m) => {
		let input = m.text?.trim();

		if (!input && m.quoted?.text) {
			input = m.quoted.text;
		}

		if (!input) {
			return m.reply("Please enter a question or message.");
		}

		try {
			const res = await GptService.process(input, {
				prompt: "Now your name is Surya and you will always reply to messages in a contemporary style, not too many emojis and not over the top, just short and cool replies.",
			});

			await m.reply(res);
		} catch (err) {
			console.error(err);
			await m.reply("An error occurred while contacting the AI.");
		}
	},
};
