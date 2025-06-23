export default {
	name: "test",
	command: [],
	hidden: true,
	owner: false,
	execute: () => {},
	periodic: {
		enabled: true,
		type: "message",
		run: async function (m) {
			console.log(
				`[TEST-PERIODIC] From: ${m.pushName} | Text: ${m.body}`
			);
			if ((m.body || "").toLowerCase().includes("tes")) {
				await m.reply("tis");
			}
		},
	},
};
