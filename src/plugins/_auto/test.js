export default {
	name: "test",
	command: [],
	hidden: true,
	owner: false,
	execute: () => {},
	periodic: {
		enabled: false,
		type: "message", // this example for type message
		run: async function (m) {
			if ((m.body || "").toLowerCase().includes("tes")) {
				await m.reply("tis");
			}
		},
	},
};
