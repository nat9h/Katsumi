import os from "node:os";
import { performance } from "perf_hooks";

export default {
	name: "ping",
	description: "Displays bot response speed.",
	command: ["ping", "p"],
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "info",
	cooldown: 0,
	limit: false,
	usage: "$prefix$command",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	/**
	 * @param {import('baileys').WASocket} sock - The Baileys socket object.
	 * @param {object} m - The serialized message object.
	 */
	// can like this, async execute(m, { property }) {..} or async execute(m) {..}
	execute: async (m) => {
		const old = performance.now();
		const ram = (os.totalmem() / Math.pow(1024, 3)).toFixed(2) + " GB";
		const free_ram = (os.freemem() / Math.pow(1024, 3)).toFixed(2) + " GB";

		m.reply(`\`\`\`Server Information

- ${os.cpus().length} CPU: ${os.cpus()[0].model}

- Uptime: ${Math.floor(os.uptime() / 86400)} days
- Ram: ${free_ram}/${ram}
- Speed: ${(performance.now() - old).toFixed(5)} ms\`\`\``);
	},
};
