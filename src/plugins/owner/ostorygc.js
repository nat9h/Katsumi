import { isMediaMessage } from "#lib/media";

export default {
	name: "oswgc",
	description: "Send group status (SWGC).",
	command: ["oswgc", "osw"],
	permissions: "owner",
	hidden: false,
	failed: "Failed to execute %command: %error",
	wait: null,
	category: "owner",
	cooldown: 0,
	limit: false,
	usage: "$prefix$command <caption?>",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: true,

	/**
	 * @param {import("../../lib/serialize").default} m
	 * @param {{ sock: import("baileys").WASocket, text: string }}
	 */
	async execute(m, { sock, text }) {
		if (!sock.swgc) {
			sock.swgc = {};
		}

		const q = m.isQuoted ? m.quoted : m;
		const type = q.type || "";
		const mime = q.mimetype || "";
		const caption = text || q.caption || "";

		if (!isMediaMessage(type) && !caption) {
			return m.reply("Reply media or send text.");
		}

		let content;

		if (type === "imageMessage" || /image\//i.test(mime)) {
			const buffer = await q.download();
			if (!buffer) {
				return m.reply("Download failed.");
			}
			content = { image: buffer, caption };
		} else if (type === "videoMessage" || /video\//i.test(mime)) {
			const buffer = await q.download();
			if (!buffer) {
				return m.reply("Download failed.");
			}
			content = { video: buffer, caption };
		} else if (
			type === "audioMessage" ||
			type === "ptt" ||
			/audio\//i.test(mime)
		) {
			const buffer = await q.download();
			if (!buffer) {
				return m.reply("Download failed.");
			}
			content = { audio: buffer, mimetype: "audio/mpeg" };
		} else {
			content = { text: caption };
		}

		const groups = Object.values(await sock.groupFetchAllParticipating());
		if (!groups.length) {
			return m.reply("No groups found.");
		}

		let listText = "*Select target group:*\n\n";
		groups.forEach((g, i) => (listText += `*${i + 1}*. ${g.subject}\n`));
		listText += "\n_Reply with number (60s)_";

		const sent = await m.reply(listText.trim());

		sock.swgc[m.sender] = {
			messageId: sent.key?.id,
			groups,
			content,
		};

		setTimeout(() => {
			if (sock.swgc?.[m.sender]?.messageId === sent.key?.id) {
				delete sock.swgc[m.sender];
			}
		}, 60_000);
	},

	/**
	 * Handle reply (group selection)
	 */
	async after(m, { sock }) {
		const session = sock.swgc?.[m.sender];
		if (!session) {
			return;
		}

		if (!m.quoted || m.quoted.id !== session.messageId) {
			return;
		}

		const indexes = [
			...new Set(
				String(m.body || "")
					.split(",")
					.map((v) => parseInt(v.trim(), 10))
					.filter((v) => Number.isFinite(v))
			),
		].filter((i) => i >= 1 && i <= session.groups.length);

		if (!indexes.length) {
			delete sock.swgc[m.sender];
			return m.reply("Invalid input. Example: 1 or 1,2");
		}

		const groupIds = indexes.map((i) => session.groups[i - 1].id);

		if (typeof sock.sendStatusMentions !== "function") {
			delete sock.swgc[m.sender];
			return console.log("sendStatusMentions isn't available.");
		}

		await sock.sendStatusMentions(groupIds, session.content);

		const sentGroups = indexes.map((i) => session.groups[i - 1].subject);

		delete sock.swgc[m.sender];

		return m.reply(
			`Status sent to:\n\n${sentGroups.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
		);
	},
};
