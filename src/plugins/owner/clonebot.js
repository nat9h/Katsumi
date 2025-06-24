import CloneBot from "../../lib/clonebot/connect.js";

export default {
	name: "clonebot",
	command: ["jadibot", "clonebot"],
	owner: true,
	usage: "$prefix$command <phone_number>",
	description:
		"Turn another WhatsApp number into a clone bot (multi-session, pairing code, MongoDB supported).",
	category: "owner",
	cooldown: 5,
	wait: null,
	hidden: true,

	/**
	 * @param {import("../../lib/serialize.js").SerializedMessage} m
	 * @param {string} text
	 * @param {import("baileys").WASocket} sock
	 */
	execute: async (m, { text, sock }) => {
		const phone = (text || "").replace(/\D/g, "");

		if (!phone || phone.length < 9) {
			return m.reply(
				[
					"❌ *Invalid phone number!*",
					"Please enter a valid phone number *with country code*, for example:",
					"```",
					`${m.prefix || ""}${m.command} 628xxxxxxxxxx`,
					"```",
				].join("\n")
			);
		}

		try {
			const onWa = await sock.onWhatsApp(`${phone}@s.whatsapp.net`);
			if (!onWa?.length) {
				return m.reply(
					[
						"❌ *This phone number is not registered on WhatsApp!*",
						"Please double-check the number and try again.",
					].join("\n")
				);
			}
		} catch (err) {
			return m.reply(
				[
					"❌ *Failed to check WhatsApp registration:*",
					err.message || err,
				].join("\n")
			);
		}

		await m.reply(`⏳ *Creating a new CloneBot session for* +${phone}...`);

		const clone = new CloneBot(phone);

		await clone.start(
			(update) => {
				console.log("update:", update);
			},
			async (result) => {
				if (result.code) {
					await m.reply(
						[
							"✅ *CloneBot Pairing Code*",
							"",
							`• *Number:* +${phone}`,
							`• *Pairing Code:* \`${result.code}\``,
							"",
							"1. Open WhatsApp on your phone.",
							"2. Go to *Linked Devices*.",
							"3. Choose *Link with phone number*.",
							"4. Enter the pairing code above.",
							"",
							"_Your new bot session will be connected in seconds!_ 🚀",
						].join("\n")
					);
				} else if (result.connected) {
					await m.reply(
						[
							"🎉 *CloneBot Connected!*",
							`• *Number:* @${phone}`,
							`• *Session:* ${result.sessionName}`,
							"",
							"_Your new bot is online and ready to go!_",
						].join("\n")
					);
				}
			},
			async (err) => {
				await m.reply(
					[
						"❌ *Failed to pair or connect:*",
						err.message || err,
					].join("\n")
				);
			}
		);
	},
};
