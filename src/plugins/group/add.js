import { getFile } from "#lib/functions";
import { WAProto, generateWAMessageFromContent, toNumber } from "baileys";

export default {
	name: "add",
	description: "Adding member to group.",
	command: ["add", "+"],
	permissions: "admin",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "group",
	cooldown: 0,
	limit: false,
	usage: "$prefix$command reply, tag or number user.",
	react: true,
	botAdmin: true,
	group: true,
	private: false,
	owner: false,

	/**
	 * @param {import('baileys').WASocket} sock - The Baileys socket object.
	 * @param {object} m - The serialized message object.
	 */
	execute: async (m, { sock }) => {
		const input = m.text
			? m.text
			: m.quoted
				? m.quoted.sender
				: m.mentions.length > 0
					? m.mentions[0]
					: false;
		if (!input) {
			return m.reply("Reply, tag or number user.");
		}
		const [result] = await sock.onWhatsApp(input.trim());
		if (!result) {
			return m.reply("User not found.");
		}
		const jid = sock.decodeJid(result.jid);
		const meta = await sock.groupMetadata(m.from);
		const member = meta.participants.find(
			(u) => u.id === jid || u.phoneNumber === jid
		);
		if (member) {
			return m.reply("User already in group.");
		}
		const resp = await sock.groupParticipantsUpdate(m.from, [jid], "add");
		const displayNumber = jid.split("@")[0];
		for (let res of resp) {
			if (res.status == 421) {
				m.reply(res.content.content[0].tag);
			}

			if (res.status == 408) {
				await m.reply(
					`Link has been successfully sent to @${displayNumber}, please wait for the user to join the group.`
				);
				await sock.sendMessage(
					jid,
					{
						text:
							"https://chat.whatsapp.com/" +
							(await sock.groupInviteCode(m.from)),
					},
					{ ephemeralExpiration: m.expiration }
				);
			}

			if (res.status == 403) {
				await m.reply(
					`Invite message has been sent to @${displayNumber}`
				);
				const inviteContent = res.content?.content?.[0];
				if (inviteContent?.attrs) {
					const { code, expiration } = inviteContent.attrs;
					const pp = await sock
						.profilePictureUrl(m.from)
						.catch(() => null);
					const gp = await getFile(pp);
					const msgs = generateWAMessageFromContent(
						jid,
						WAProto.Message.fromObject({
							groupInviteMessage: {
								groupJid: m.from,
								inviteCode: code,
								inviteExpiration: toNumber(expiration),
								groupName: await sock.getName(m.from),
								jpegThumbnail: gp ? gp.data : null,
								caption: "Invitation to join my WhatsApp group",
							},
						}),
						{ userJid: sock.user.id }
					);

					await sock.sendMessage(
						jid,
						{ forward: msgs },
						{ ephemeralExpiration: m.expiration }
					);
				} else {
					console.error(
						"Failed to parse invite code from response:",
						res
					);
					m.reply("Failed to generate invite message.");
				}
			}
		}
	},
};
