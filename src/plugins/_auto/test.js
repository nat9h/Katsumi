export default {
	name: "test",
	command: [],
	hidden: true,
	owner: false,
	execute: () => {},
	periodic: {
		enabled: false,
		type: "message",
		run: async function (m) {
			if (/tes/i.test(m.body || "")) {
				await m.reply("tis");
			}
		},
	},
};
