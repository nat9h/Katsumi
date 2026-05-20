import {
    generateForwardMessageContent,
    generateWAMessageFromContent,
    proto,
} from "baileys";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { findContextInfo, unwrapMessage } from "#libs/utils/message";

export default new CommandBuilder()
    .setName("quoted")
    .setAliases("q", "getquoted")
    .setDescription("Retrieve the quoted/replied message from a reply")
    .setUsage("{prefix}{name}")
    .setReact("💬")
    .setRateLimit(8_000, 3)
    .setHandler(async (interaction) => {
        const { quoted, chatJid, client, sock, msg, isGroup } = interaction;
        if (!quoted) {
            return interaction.reply(
                "Reply to a message that quotes another message.",
            );
        }

        const cached = client.messageCache.get(`${chatJid}_${quoted.stanzaId}`);
        const ctx = findContextInfo(cached?.message || quoted.message);

        if (!ctx?.quotedMessage) {
            return interaction.reply("Message not found.");
        }

        const innerMsg = unwrapMessage(ctx.quotedMessage) || ctx.quotedMessage;
        const sender = ctx.participant || chatJid;

        const fakeMsg = proto.WebMessageInfo.fromObject({
            key: {
                remoteJid: chatJid,
                fromMe: false,
                id: ctx.stanzaId || "",
                participant: sender,
            },
            message: innerMsg,
            ...(isGroup ? { participant: sender } : {}),
        });

        const content = generateForwardMessageContent(fakeMsg, false);
        const type = Object.keys(content)[0];
        if (content[type]?.contextInfo) {
            delete content[type].contextInfo.forwardingScore;
            delete content[type].contextInfo.isForwarded;
        }

        const expiration = interaction.expiration;
        const gen = generateWAMessageFromContent(chatJid, content, {
            userJid: sock.user?.id,
            quoted: msg,
            ...(expiration ? { ephemeralExpiration: expiration } : {}),
        });

        await sock.relayMessage(chatJid, gen.message, {
            messageId: gen.key.id,
        });
    });
