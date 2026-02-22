import deepinfra from "#lib/scrapers/deepseek";

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
	execute: async (m, { sock }) => {
		let input = m.text?.trim();

		if (!input && m.quoted?.text) {
			input = m.quoted.text;
		}

		if (!input) {
			return m.reply("Please enter a question or message.");
		}

		if (!sock.deepseek) {
			sock.deepseek = {};
		}
		if (!sock.deepseek[m.sender]) {
			sock.deepseek[m.sender] = [];
		}

		sock.deepseek[m.sender].push({
			role: "user",
			content: input,
		});

		try {
			const res = await deepinfra(
				"deepseek-ai/DeepSeek-V3.1",
				sock.deepseek[m.sender]
			);

			sock.deepseek[m.sender].push({
				role: "assistant",
				content: res,
			});

			if (sock.deepseek[m.sender].length > 20) {
				sock.deepseek[m.sender] = sock.deepseek[m.sender].slice(-20);
			}

			await m.reply(res);
		} catch (err) {
			console.error(err);
			await m.reply("An error occurred while contacting the AI.");
		}
	},
};
