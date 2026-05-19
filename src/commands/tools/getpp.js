import { CommandBuilder } from "#structures/CommandBuilder";
import { fetchProfilePicture, queryBusinessProfile } from "#utils/profile";

export default new CommandBuilder()
    .setName("getpp")
    .setAliases("pp", "profilepic", "avatar")
    .setDescription("Get profile picture of a user or group")
    .setUsage("{prefix}{name} [@mention/reply]")
    .setExample("{prefix}{name} @user")
    .setNote(
        [
            "• Mention or reply to get their profile picture",
            "• No target → your own profile picture",
            "• If the target is a WA Business account, the cover/banner will also be sent",
        ].join("\n"),
    )
    .setReact("🖼️")
    .setRateLimit(8_000, 3)
    .setHandler(async (interaction) => {
        const { sock, quoted, mentions, user } = interaction;
        let targetJid;
        if (mentions.length > 0) {
            targetJid = mentions[0];
        } else if (quoted) {
            targetJid = quoted.sender;
        } else {
            targetJid = user;
        }

        if (!targetJid) {
            return interaction.reply("Could not determine target user.");
        }

        await interaction.typing();

        const ppUrl = await fetchProfilePicture(sock, targetJid, "image").catch(
            () => null,
        );

        if (!ppUrl) {
            return interaction.reply(
                "Profile picture not found or privacy is restricted.",
            );
        }

        await interaction.reply({
            image: { url: ppUrl },
            caption: `Profile picture of @${targetJid.split("@")[0]}`,
            mentions: [targetJid],
        });

        const bizResult = await queryBusinessProfile(sock, targetJid);
        if (!bizResult) {
            return;
        }

        const { profile: bizProfile, coverUrl } = bizResult;

        const lines = [];
        if (bizProfile.displayName) {
            lines.push(`🏪 *${bizProfile.displayName}*`);
        }
        if (bizProfile.category) {
            lines.push(`🏷️ ${bizProfile.category}`);
        }
        if (bizProfile.description) {
            lines.push(`📝 ${bizProfile.description}`);
        }
        if (bizProfile.address) {
            lines.push(`📍 ${bizProfile.address}`);
        }
        if (bizProfile.email) {
            lines.push(`📧 ${bizProfile.email}`);
        }
        if (bizProfile.website?.length) {
            lines.push(`🌐 ${bizProfile.website.join(", ")}`);
        }

        if (coverUrl && lines.length > 0) {
            await interaction.followUp({
                image: { url: coverUrl },
                caption: `*WA Business*\n${lines.join("\n")}`,
                mentions: [targetJid],
            });
        } else if (coverUrl) {
            await interaction.followUp({
                image: { url: coverUrl },
                caption: "WA Business cover photo",
            });
        } else if (lines.length > 0) {
            await interaction.followUp(`*WA Business*\n${lines.join("\n")}`);
        }
    });
