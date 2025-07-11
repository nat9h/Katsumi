import { S_WHATSAPP_NET } from "baileys";
import * as Jimp from "jimp";

export default {
	name: "setpp",
	description: "Change profile picture.",
	command: ["setpp", "changepp"],
	permissions: "owner",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "owner",
	cooldown: 3,
	limit: false,
	usage: "$prefix$command send/reply_media.",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: true,

	/**
	 * @param {import('baileys').WASocket} sock - The Baileys socket object.
	 * @param {object} m - The serialized message object.
	 */
	async execute(m, { sock }) {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q.type || "";

		if (!/image|document/g.test(mime)) {
			return m.reply("Please reply/send a image with the command.");
		}

		const media = await q.download();

		async function pp() {
			const image = await Jimp.read(media);
			const mwmwx =
				image.getWidth() > image.getHeight()
					? image.resize(720, Jimp.AUTO)
					: image.resize(Jimp.AUTO, 720);
			return {
				img: await mwmwx.getBufferAsync(Jimp.MIME_JPEG),
			};
		}

		let { img } = await pp();
		if (!img) {
			return m.reply("Failed.");
		}

		await sock.query({
			tag: "iq",
			attrs: {
				to: S_WHATSAPP_NET,
				type: "set",
				xmlns: "w:profile:picture",
			},
			content: [
				{
					tag: "picture",
					attrs: { type: "image" },
					content: img,
				},
			],
		});
		m.reply("Successfully change group.");
	},
};
