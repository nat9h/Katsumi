export default {
	name: "readviewonce",
	description: "Readviewonce message.",
	command: ["rvo", "readviewonce"],
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "misc",
	cooldown: 5,
	limit: false,
	usage: "$prefix$command <reply_view_once>",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	/**
	 * @param {import('baileys').WASocket} sock - The Baileys socket object.
	 * @param {object} m - The serialized message object.
	 */
	execute: async (m) => {
		const q = m.quoted ? m.quoted : m;
		const type = Object.keys(q.message || q)[0];
		if (!q.message?.[type].viewOnce) {
			return m.reply("This message isn't viewonce.");
		}
		const caption = q.message[type].caption || "";
		if (/audio/.test(type)) {
			return await m.reply({ audio: await q.download(), ptt: true });
		}
		await m.reply({
			[type.includes("image") ? "image" : "video"]: await q.download(),
			caption,
		});
	},
};
