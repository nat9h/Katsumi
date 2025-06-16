import baileys, { generateWAMessageFromContent, toNumber } from "baileys";
import { getFile } from "../../lib/functions.js";

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
	async execute(m, { sock }) {
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
		const p = await sock.onWhatsApp(input.trim());
		if (p.length == 0) {
			return m.reply("User not found.");
		}
		const jid = sock.decodeJid(p[0].jid);
		const meta = await sock.groupMetadata(m.from);
		const member = meta.participants.find((u) => u.id == jid);
		if (member?.id) {
			return m.reply("User already in group.");
		}
		const resp = await sock.groupParticipantsUpdate(m.from, [jid], "add");
		for (let res of resp) {
			if (res.status == 421) {
				m.reply(res.content.content[0].tag);
			}
			if (res.status == 408) {
				await m.reply(
					`Link has been successfully sent to @${res.jid}, please wait for the user to join the group.`
				);
				await sock.sendMessage(res.jid, {
					text:
						"https://chat.whatsapp.com/" +
						(await sock.groupInviteCode(m.from)),
				});
			}
			if (res.status == 403) {
				await m.reply(`Invite message has been sent to @${res.jid}`);
				const { code, expiration } = res.content.content[0].attrs;
				const pp = await sock
					.profilePictureUrl(m.from)
					.catch(() => null);
				const gp = await getFile(pp);
				const msgs = generateWAMessageFromContent(
					res.jid,
					baileys.proto.Message.fromObject({
						groupInviteMessage: {
							groupJid: m.from,
							inviteCode: code,
							inviteExpiration: toNumber(expiration),
							groupName: await sock.getName(m.from),
							jpegThumbnail: gp ? gp.data : null,
							caption: "Invitation to join my WhatsApp group",
						},
					}),
					{ userJid: sock.user.jid }
				);

				await sock.sendMessage(
					res.jid,
					{
						forward: msgs,
					},
					{ ephemeralExpiration: m.expiration }
				);
			}
		}
	},
};
