export default {
	name: "getinfo",
	description: "Get full information from a WhatsApp Channel or Group invite link.",
	command: ["getinfo"],
	permissions: "all",
	category: "tools",
	cooldown: 5,
	wait: null,
	react: true,
	failed: "Failed to %command: %error",
	usage: "$prefix$command <url>",

	execute: async (m, { sock }) => {
		const text = m.text?.trim();
		if (!text) return m.reply("Please provide a group or channel invite link.");

		const formatDateTime = (timestamp) => {
			if (!timestamp || timestamp === 0) return "Not available";

			const date = new Date(timestamp * 1000);
			return date.toLocaleString("en-US", {
				timeZone: "Asia/Jakarta",
				year: "numeric",
				month: "long",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hour12: false
			}) + " WIB";
		};

		const formatDateOnly = (timestamp) => {
			if (!timestamp || timestamp === 0) return "Not available";

			const date = new Date(timestamp * 1000);
			return date.toLocaleString("en-US", {
				timeZone: "Asia/Jakarta",
				year: "numeric",
				month: "long",
				day: "numeric"
			}) + " WIB";
		};

		try {
			if (text.includes("whatsapp.com/channel/")) {

				const inviteCode = text
					.split("whatsapp.com/channel/")[1]
					?.split(/[\s?]/)[0];

				if (!inviteCode) return m.reply("Invalid invite code.");

				const metadata = await sock.newsletterMetadata("invite", inviteCode);
				const info = metadata.thread_metadata;

				let caption = `📢 *CHANNEL INFORMATION*\n`;
				caption += `━━━━━━━━━━━━━━━━━━\n\n`;

				caption += `🆔 *Channel ID:* ${metadata.id}\n`;
				caption += `📌 *State:* ${metadata.state?.type || "Unknown"}\n`;
				caption += `👁️ *Viewer Metadata:* ${metadata.viewer_metadata || "None"}\n\n`;

				caption += `📛 *Name:* ${info.name?.text || "Unknown"}\n`;
				caption += `🆔 *Name ID:* ${info.name?.id || "Unknown"}\n`;
				caption += `🕒 *Name Updated:* ${formatDateTime(info.name?.update_time)}\n\n`;

				caption += `📝 *Description:*\n${info.description?.text || "No description"}\n\n`;
				caption += `🆔 *Description ID:* ${info.description?.id || "Unknown"}\n`;
				caption += `🕒 *Description Updated:* ${formatDateTime(info.description?.update_time)}\n\n`;

				caption += `📅 *Created On:* ${formatDateTime(info.creation_time)}\n`;
				caption += `🔖 *Handle:* ${info.handle || "None"}\n`;
				caption += `🔗 *Invite Code:* ${info.invite || inviteCode}\n`;
				caption += `🖼️ *Picture:* ${info.picture || "None"}\n\n`;

				caption += `🖼️ *Preview Type:* ${info.preview?.type || "None"}\n`;
				caption += `🆔 *Preview ID:* ${info.preview?.id || "None"}\n`;
				caption += `🌐 *Preview URL:* ${
					info.preview?.direct_path
						? `https://pps.whatsapp.net${info.preview.direct_path}`
						: "Not available"
				}\n\n`;

				caption += `💬 *Reaction Mode:* ${info.settings?.reaction_codes?.value || "ALL"}\n`;
				caption += `👥 *Subscribers:* ${info.subscribers_count || 0}\n`;
				caption += `✔️ *Verification Status:* ${info.verification || "NOT_VERIFIED"}\n`;

				return m.reply(caption);
			}
			if (text.includes("chat.whatsapp.com/")) {

				const inviteCode = text
					.split("chat.whatsapp.com/")[1]
					?.split(/[\s?]/)[0];

				if (!inviteCode) return m.reply("Invalid invite code.");

				const metadata = await sock.groupGetInviteInfo(inviteCode);

				const totalMembers = metadata.participants?.length || 0;
				const totalAdmins =
					metadata.participants?.filter(p => p.admin)?.length || 0;
				const totalRegular = totalMembers - totalAdmins;

				let ephemeralText = "Disabled";
				if (metadata.ephemeralDuration) {
					const seconds = metadata.ephemeralDuration;
					const hours = seconds / 3600;
					const days = hours / 24;

					if (days >= 1) {
						ephemeralText = `${days} day(s) (${seconds} seconds)`;
					} else if (hours >= 1) {
						ephemeralText = `${hours} hour(s) (${seconds} seconds)`;
					} else {
						ephemeralText = `${seconds} seconds`;
					}
				}

				let caption = `👥 *GROUP INFORMATION*\n`;
				caption += `━━━━━━━━━━━━━━━━━━\n\n`;

				caption += `🆔 *Group ID:* ${metadata.id}\n`;
				caption += `📌 *Addressing Mode:* ${metadata.addressingMode || "Unknown"}\n`;
				caption += `📛 *Subject:* ${metadata.subject}\n`;
				caption += `👑 *Subject Owner:* ${metadata.subjectOwner || "Unknown"}\n`;
				caption += `📱 *Subject Owner Number:* ${metadata.subjectOwnerPn || "Unknown"}\n`;
				caption += `🕒 *Subject Updated:* ${formatDateTime(metadata.subjectTime)}\n\n`;

				caption += `📅 *Created On:* ${formatDateOnly(metadata.creation)}\n`;
				caption += `👑 *Group Owner:* ${metadata.owner || "Unknown"}\n`;
				caption += `📱 *Owner Number:* ${metadata.ownerPn || "Unknown"}\n`;
				caption += `🌍 *Owner Country Code:* ${metadata.owner_country_code || "Unknown"}\n\n`;

				caption += `👥 *Members (Metadata):* ${metadata.size}\n`;
				caption += `👥 *Total Members:* ${totalMembers}\n`;
				caption += `🛡️ *Total Admins:* ${totalAdmins}\n`;
				caption += `🙋 *Regular Members:* ${totalRegular}\n\n`;

				caption += `🔒 *Restricted:* ${metadata.restrict ? "Yes" : "No"}\n`;
				caption += `📢 *Announcement Mode:* ${metadata.announce ? "Yes" : "No"}\n`;
				caption += `🏘️ *Community Group:* ${metadata.isCommunity ? "Yes" : "No"}\n`;
				caption += `📣 *Community Announcement:* ${metadata.isCommunityAnnounce ? "Yes" : "No"}\n`;
				caption += `✅ *Join Approval Required:* ${metadata.joinApprovalMode ? "Yes" : "No"}\n`;
				caption += `➕ *Member Add Mode:* ${metadata.memberAddMode || "Unknown"}\n`;
				caption += `⏳ *Ephemeral Duration:* ${ephemeralText}\n\n`;

				caption += `📝 *Description:*\n${metadata.desc || "No description"}\n\n`;
				caption += `🆔 *Description ID:* ${metadata.descId || "None"}\n`;
				caption += `👤 *Description Owner:* ${metadata.descOwner || "Unknown"}\n`;
				caption += `📱 *Description Owner Number:* ${metadata.descOwnerPn || "Unknown"}\n`;
				caption += `🕒 *Description Updated:* ${formatDateTime(metadata.descTime)}\n`;

				return m.reply(caption);
			}

			return m.reply("Unrecognized link format.");
		} catch (err) {
			console.error(err);
			return m.reply("Failed to retrieve information.");
		}
	},
};