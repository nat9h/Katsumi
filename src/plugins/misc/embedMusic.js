export default {
	name: "embed",
	description: "Send videos with embedded music.",
	command: ["embed", "embedMusic"],
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "misc",
	cooldown: 5,
	limit: false,
	usage: "$prefix$command",
	react: false,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	/**
	 * @param {import('baileys').WASocket} sock
	 * @param {object} m
	 */
	execute: async (m) => {
		await m.reply({
			video: {
				url: "https://a.top4top.io/m_3706zd9k00.mp4",
			},
			caption: "jawa banget",
			streamingSidecar:
				"QD4XJIMi3ARGTYV8zNWRfNX05nc//e7lxshUO2RH/NuhA7tkg5ew/vPfKOFtIrTt/+E=",
			annotations: [
				{
					embeddedContent: {
						embeddedMusic: {
							musicContentMediaId: 12,
							songId: 11,
							author: "Shinaru",
							title: "Oryta Community",
							artistAttribution:
								"https://github.com/sh1njs/Katsumi",
						},
					},
					embeddedAction: true,
				},
			],
		});
	},
};
