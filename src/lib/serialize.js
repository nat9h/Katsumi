import { BOT_CONFIG } from "#config/index";
import * as Func from "#lib/functions";
import { getPrefix } from "#lib/prefix";
import Sticker from "#lib/sticker";
import { to_audio } from "#utils/converter";
import {
	STORIES_JID,
	WAProto,
	areJidsSameUser,
	chatModificationToAppPatch,
	downloadMediaMessage,
	extractMessageContent,
	generateForwardMessageContent,
	generateWAMessage,
	generateWAMessageFromContent,
	getContentType,
	jidDecode,
	jidNormalizedUser,
} from "baileys";
import { fileTypeFromBuffer } from "file-type";
import { randomBytes } from "node:crypto";
import { existsSync, promises, readFileSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

const randomId = (length = 16) => randomBytes(length).toString("hex");
const extractNumber = (jid) => (jid?.match(/\d{8,}/) || [])[0] || null;

const parseMessage = (content) => {
	content = extractMessageContent(content);

	const handlers = [
		(msg) => msg?.viewOnceMessageV2Extension?.message,
		(msg) => msg?.viewOnceMessageV2?.message,
		(msg) =>
			msg?.protocolMessage?.type === 14
				? msg.protocolMessage[getContentType(msg.protocolMessage)]
				: msg,
		(msg) =>
			msg?.message ? msg.message[getContentType(msg.message)] : msg,
	];

	for (const handler of handlers) {
		const result = handler(content);
		if (result) {
			content = result;
			break;
		}
	}

	return content;
};

const parsePhoneNumber = (number) => {
	const cleaned = ("" + number).replace(/\D/g, "");

	const formatters = {
		62: (num) =>
			num.length >= 11 && num.length <= 13
				? `+${num.slice(0, 2)} ${num.slice(2, 6)} ${num.slice(6, 10)} ${num.slice(10)}`
				: num.length === 10
					? `+${num.slice(0, 2)} ${num.slice(2, 4)} ${num.slice(4, 7)} ${num.slice(7)}`
					: num,
		1: (num) =>
			num.length === 10
				? `+1 ${num.slice(0, 3)}-${num.slice(3, 6)}-${num.slice(6)}`
				: num.length === 11
					? `+${num.slice(0, 1)} ${num.slice(1, 4)}-${num.slice(4, 7)}-${num.slice(7)}`
					: num,
	};

	for (const [prefix, formatter] of Object.entries(formatters)) {
		if (cleaned.startsWith(prefix)) {
			return formatter(cleaned);
		}
	}
	return number;
};

/**
 * LID <-> PN (Baileys v7+)
 * - Prefer msg hints (participantPn, senderPn, etc) if present
 * - Else metadata participants map
 * - Else canonical Baileys store: sock.signalRepository.lidMapping.getPNForLID / getLIDForPN
 *   (see Baileys LIDMappingStore)
 */
const isLidJid = (jid) =>
	typeof jid === "string" && /@lid$|@hosted\.lid$/.test(jid);

const normJid = (jid) => (jid ? jidNormalizedUser(jid) : jid);

/**
 * Build fast bidirectional map from group metadata participants.
 * v7 participants generally use { id, phoneNumber?, lid? } pattern.
 */
export const buildIdentityMap = (participants = []) => {
	const lidToPn = {};
	const pnToLid = {};

	for (const p of participants) {
		const id = p?.id ? normJid(p.id) : null;
		const pn = p?.phoneNumber ? normJid(p.phoneNumber) : null;
		const lid = p?.lid ? normJid(p.lid) : null;

		if (!id) {
			continue;
		}

		if (isLidJid(id)) {
			if (pn && !isLidJid(pn)) {
				lidToPn[id] = pn;
			}
		} else {
			if (lid && isLidJid(lid)) {
				pnToLid[id] = lid;
			}
		}
	}

	return { lidToPn, pnToLid };
};

async function resolveToPn(jid, { sock, idMap, pnHint } = {}) {
	jid = normJid(jid);
	pnHint = normJid(pnHint);

	if (!jid) {
		return jid;
	}

	if (!isLidJid(jid)) {
		return jid;
	}

	if (pnHint && !isLidJid(pnHint)) {
		return pnHint;
	}

	const fromMeta = idMap?.lidToPn?.[jid];
	if (fromMeta) {
		return fromMeta;
	}

	const store = sock?.signalRepository?.lidMapping;
	if (store?.getPNForLID) {
		const pn = await store.getPNForLID(jid);
		if (pn) {
			return normJid(pn);
		}
	}

	return jid;
}

async function resolveToLid(jid, { sock, idMap, lidHint } = {}) {
	jid = normJid(jid);
	lidHint = normJid(lidHint);

	if (!jid) {
		return jid;
	}
	if (isLidJid(jid)) {
		return jid;
	}

	if (lidHint && isLidJid(lidHint)) {
		return lidHint;
	}

	const fromMeta = idMap?.pnToLid?.[jid];
	if (fromMeta) {
		return fromMeta;
	}

	const store = sock?.signalRepository?.lidMapping;
	if (store?.getLIDForPN) {
		const lid = await store.getLIDForPN(jid);
		if (lid) {
			return normJid(lid);
		}
	}

	return jid;
}

/**
 * Helper: Safely parses mentions (tags) from text.
 * Checks whether `parseMention` exists on the socket before calling it.
 */
function safeParseMention(sock, text) {
	return typeof sock.parseMention === "function"
		? sock.parseMention(text)
		: [];
}

export function Client({ sock, store }) {
	const client = Object.defineProperties(sock, {
		sendAlbum: {
			async value(jid, array, quoted) {
				const album = generateWAMessageFromContent(
					jid,
					{
						messageContextInfo: {
							messageSecret: randomBytes(32),
						},
						albumMessage: {
							expectedImageCount: array.filter((a) =>
								Object.prototype.hasOwnProperty.call(a, "image")
							).length,
							expectedVideoCount: array.filter((a) =>
								Object.prototype.hasOwnProperty.call(a, "video")
							).length,
						},
					},
					{
						userJid: sock.user.id,
						quoted,
						upload: sock.waUploadToServer,
					}
				);
				await sock.relayMessage(album.key.remoteJid, album.message, {
					messageId: album.key.id,
				});

				for (let content of array) {
					const img = await generateWAMessage(
						album.key.remoteJid,
						content,
						{
							upload: sock.waUploadToServer,
						}
					);
					img.message.messageContextInfo = {
						messageSecret: randomBytes(32),
						messageAssociation: {
							associationType: 1,
							parentMessageKey: album.key,
						},
					};
					await sock.relayMessage(img.key.remoteJid, img.message, {
						messageId: img.key.id,
					});
				}

				return album;
			},
		},

		clearChat: {
			async value(jid, messages) {
				const msg = messages[messages.length - 1];
				const patch = chatModificationToAppPatch({ clear: true }, jid);

				patch.syncAction.clearChatAction = {
					messageRange: {
						lastMessageTimestamp: msg.messageTimestamp,
						messages,
					},
				};
				patch.index[2] = "0";
				return sock.appPatch(patch);
			},
		},

		sendStatusMentions: {
			async value(content, jids, opts = {}) {
				const targetJid = [];
				const statusJidList = [sock.user.id];

				const formatJid = (jid) => ({
					tag: "to",
					attrs: { jid },
					content: undefined,
				});

				const processJid = async (jid) => {
					if (jid.endsWith("@g.us")) {
						targetJid.push(formatJid(jid));
						const groupData = await store.getGroupMetadata(jid);
						statusJidList.push(
							...groupData.participants.map((j) => j.id)
						);
					} else {
						jid = jid.replace(/\D/g, "") + "@s.whatsapp.net";
						targetJid.push(formatJid(jid));
						statusJidList.push(jid);
					}
				};

				await Promise.all(jids.map(processJid));

				const media = await generateWAMessage(STORIES_JID, content, {
					upload: sock.waUploadToServer,
					...opts,
				});

				const additionalNodes = [
					{
						tag: "meta",
						attrs: {},
						content: [
							{
								tag: "mentioned_users",
								attrs: {},
								content: targetJid,
							},
						],
					},
				];

				await sock.relayMessage(STORIES_JID, media.message, {
					messageId: media.key.id,
					statusJidList,
					additionalNodes,
				});

				await Promise.all(
					targetJid.map(async (val) => {
						const jid = val.attrs.jid;
						const msgType = jid.endsWith("@g.us")
							? "groupStatusMentionMessage"
							: "statusMentionMessage";
						const msg = await generateWAMessageFromContent(
							jid,
							{
								[msgType]: {
									message: {
										protocolMessage: {
											key: media.key,
											type: 25,
										},
									},
								},
							},
							{}
						);

						const attrsType = jid.endsWith("@g.us")
							? "is_group_status_mention"
							: "is_status_mention";
						if (!opts.silent) {
							await sock.relayMessage(jid, msg.message, {
								additionalNodes: [
									{
										tag: "meta",
										attrs: { [attrsType]: "true" },
										content: undefined,
									},
								],
							});
						}
					})
				);

				return media;
			},
		},

		decodeJid: {
			value(jid) {
				if (!jid) {
					return jid;
				}
				if (/:\d+@/gi.test(jid)) {
					const decode = jidDecode(jid) || {};
					return (
						(decode.user &&
							decode.server &&
							`${decode.user}@${decode.server}`) ||
						jid
					);
				}
				return jid;
			},
		},

		getName: {
			value(jid) {
				const id = jidNormalizedUser(jid);
				if (id.endsWith("g.us")) {
					const metadata = store.getGroupMetadata(id);
					return metadata?.subject || id;
				}
				const contact = store.getContact(id);
				if (!contact) {
					return parsePhoneNumber("+" + id.split("@")[0]);
				}

				return (
					contact?.name ||
					contact?.notify ||
					contact?.verifiedName ||
					parsePhoneNumber("+" + id.split("@")[0])
				);
			},
		},

		sendContact: {
			async value(jid, numbers, quoted, options = {}) {
				const list = numbers
					.filter((v) => !v.endsWith("g.us"))
					.map((v) => {
						const cleaned = v.replace(/\D+/g, "");
						const jid = `${cleaned}@s.whatsapp.net`;
						return {
							displayName: sock.getName(jid),
							vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${sock.getName(jid)}\nFN:${sock.getName(jid)}\nitem1.TEL;waid=${cleaned}:${cleaned}\nEND:VCARD`,
						};
					});

				return sock.sendMessage(
					jid,
					{
						contacts: {
							displayName: `${list.length} Contact${list.length > 1 ? "s" : ""}`,
							contacts: list,
						},
					},
					{ quoted, ...options }
				);
			},
			enumerable: true,
		},

		parseMention: {
			value(text) {
				return (
					[...text.matchAll(/@([0-9]{5,16}|0)/g)].map(
						(v) => v[1] + "@s.whatsapp.net"
					) || []
				);
			},
		},

		downloadMedia: {
			async value(message, filename) {
				let media = await downloadMediaMessage(
					message,
					"buffer",
					{},
					{
						logger: pino({
							timestamp: () => `,"time":"${new Date().toJSON()}"`,
							level: "fatal",
						}).child({ class: "sock" }),
						reuploadRequest: sock.updateMediaMessage,
					}
				);

				if (filename) {
					let mime = await fileTypeFromBuffer(media);
					let filePath = join(
						process.cwd(),
						`${filename}.${mime.ext}`
					);
					await promises.writeFile(filePath, media);
					return filePath;
				}

				return media;
			},
			enumerable: true,
		},

		sendMedia: {
			async value(jid, url, quoted = "", options = {}) {
				let { mime, data: buffer, ext, size } = await Func.getFile(url);
				mime = options?.mimetype ? options.mimetype : mime;
				let data = { text: "" },
					mimetype = /audio/i.test(mime) ? "audio/mpeg" : mime;

				if (size > 45000000) {
					data = {
						document: buffer,
						mimetype: mime,
						fileName: options?.fileName
							? options.fileName
							: `Natsumi_(${new Date()}).${ext}`,
						...options,
					};
				} else if (options.asDocument) {
					data = {
						document: buffer,
						mimetype: mime,
						fileName: options?.fileName
							? options.fileName
							: `Natsumi_(${new Date()}).${ext}`,
						...options,
					};
				} else if (options.asSticker || /webp/.test(mime)) {
					let pathFile = await Sticker.create(
						{ mimetype, data: buffer },
						{ ...options }
					);
					data = {
						sticker: readFileSync(pathFile),
						mimetype: "image/webp",
						...options,
					};
					existsSync(pathFile) ? await promises.unlink(pathFile) : "";
				} else if (/image/.test(mime)) {
					data = {
						image: buffer,
						mimetype: options?.mimetype
							? options.mimetype
							: "image/png",
						...options,
					};
				} else if (/video/.test(mime)) {
					data = {
						video: buffer,
						mimetype: options?.mimetype
							? options.mimetype
							: "video/mp4",
						...options,
					};
				} else if (/audio/.test(mime)) {
					data = {
						audio: await to_audio(buffer, "mp3"),
						mimetype: options?.mimetype
							? options.mimetype
							: "audio/mpeg",
						...options,
					};
				} else {
					data = {
						document: buffer,
						mimetype: mime,
						...options,
					};
				}

				return await sock.sendMessage(jid, data, {
					quoted,
					messageId: randomId(32),
					...options,
				});
			},
			enumerable: true,
		},

		cMod: {
			value(jid, copy, text = "", sender = sock.user.id, options = {}) {
				let mtype = getContentType(copy.message);
				let content = copy.message[mtype];

				if (typeof content === "string") {
					copy.message[mtype] = text || content;
				} else if (content.caption) {
					content.caption = text || content.caption;
				} else if (content.text) {
					content.text = text || content.text;
				}

				if (typeof content !== "string") {
					copy.message[mtype] = { ...content, ...options };
					copy.message[mtype].contextInfo = {
						...(content.contextInfo || {}),
						mentionedJid:
							options.mentions ||
							content.contextInfo?.mentionedJid ||
							[],
					};
				}

				if (copy.key.participant) {
					sender = copy.key.participant =
						sender || copy.key.participant;
				}
				if (copy.key.remoteJid.includes("@s.whatsapp.net")) {
					sender = sender || copy.key.remoteJid;
				} else if (copy.key.remoteJid.includes("@broadcast")) {
					sender = sender || copy.key.remoteJid;
				}

				copy.key.remoteJid = jid;
				copy.key.fromMe = areJidsSameUser(sender, sock.user.id);
				return WAProto.WebMessageInfo.fromObject(copy);
			},
			enumerable: false,
		},

		getGroupMentionJids: {
			/**
			 * Return list of JIDs to mention for a group.
			 * Prefer PN (@s.whatsapp.net) if possible; fallback to LID if not.
			 * Uses resolveToPn() which chains: hint -> metadata map -> lidMapping store. :contentReference[oaicite:1]{index=1}
			 *
			 * @param {import('baileys').GroupMetadata} metadata
			 * @param {{ preferPn?: boolean }} [opts]
			 * @returns {Promise<string[]>}
			 */
			async value(metadata, opts = {}) {
				const preferPn = opts.preferPn !== false;
				const isPn = (jid) =>
					typeof jid === "string" && jid.endsWith("@s.whatsapp.net");

				const participants = metadata?.participants || [];
				const idMap = buildIdentityMap(participants);

				const out = [];
				const seen = new Set();

				for (const p of participants) {
					const base =
						normJid(p?.phoneNumber) ||
						normJid(p?.jid) ||
						normJid(p?.id) ||
						normJid(p?.lid);

					if (!base) {
						continue;
					}

					let chosen = base;

					if (preferPn) {
						chosen = await resolveToPn(base, { sock, idMap });
					}

					if (preferPn && chosen && !isPn(chosen)) {
						chosen = base;
					}

					if (chosen && !seen.has(chosen)) {
						seen.add(chosen);
						out.push(chosen);
					}
				}

				return out;
			},
			enumerable: true,
		},

		copyNForward: {
			async value(jid, message, forwardingScore = true, options = {}) {
				let m = generateForwardMessageContent(
					message,
					!!forwardingScore
				);
				let mtype = Object.keys(m)[0];
				if (
					forwardingScore &&
					typeof forwardingScore == "number" &&
					forwardingScore > 1
				) {
					m[mtype].contextInfo.forwardingScore += forwardingScore;
				}
				let preparedMessage = generateWAMessageFromContent(jid, m, {
					...options,
					userJid: sock.user.id,
				});

				await sock.relayMessage(jid, preparedMessage.message, {
					messageId: preparedMessage.key.id,
					additionalAttributes: { ...options },
				});

				return preparedMessage;
			},
			enumerable: true,
		},
	});

	return client;
}

export default async function serialize(sock, msg, store) {
	const m = {};

	m.sock = sock;
	m.isClonebot = sock.isClonebot || false;

	if (!msg) {
		return msg;
	}
	if (!msg.message) {
		return null;
	}

	m.message = parseMessage(msg.message);
	m.messageTimestamp =
		msg.messageTimestamp ||
		(msg.key && msg.key.timestamp) ||
		Date.now() / 1000;

	if (msg.key) {
		m.key = msg.key;
		m.from = m.key.remoteJid.startsWith("status")
			? normJid(m.key?.participant || msg.participant)
			: normJid(m.key.remoteJid);

		m.fromMe = !!m.key.fromMe;
		m.id = m.key.id;

		m.device = /^3A/.test(m.id)
			? "ios"
			: m.id.startsWith("3EB")
				? "web"
				: /^.{21}/.test(m.id)
					? "android"
					: /^.{18}/.test(m.id)
						? "desktop"
						: "unknown";

		m.isBot =
			(m.id.startsWith("BAE5") && m.id.length === 16) ||
			(m.id.startsWith("B24E") && m.id.length === 20);

		m.isGroup = m.from.endsWith("@g.us");
	}

	let metadata = null;
	let idMap = { lidToPn: {}, pnToLid: {} };

	if (m.isGroup) {
		metadata = store.getGroupMetadata(m.from);
		if (!metadata) {
			try {
				metadata = await sock.groupMetadata(m.from);
				store.setGroupMetadata(m.from, metadata);
			} catch {
				metadata = null;
			}
		}
		if (metadata?.participants?.length) {
			metadata.participants = metadata.participants.map((p) => ({
				...p,
				id: normJid(p.id || p.jid),
				jid: normJid(p.jid),
				phoneNumber: normJid(p.phoneNumber),
				lid: normJid(p.lid),
			}));
			idMap = buildIdentityMap(metadata.participants);
		}

		m.metadata = metadata || null;
		m._idMap = idMap;

		m.groupAdmins = m.metadata
			? m.metadata.participants
					.filter((p) => p.admin)
					.map((p) => ({
						id: p.id,
						jid: p.jid,
						phoneNumber: p.phoneNumber,
						lid: p.lid,
						admin: p.admin,
					}))
			: [];

		m.isAdmin = false;
		m.isBotAdmin = false;
	} else {
		m.metadata = null;
		m._idMap = idMap;
		m.groupAdmins = [];
		m.isAdmin = false;
		m.isBotAdmin = false;
	}

	const rawParticipant =
		typeof (msg?.participant || msg?.key?.participant) === "string"
			? msg?.participant || msg?.key?.participant
			: "";

	const rawParticipantPn =
		typeof (msg?.participantPn || msg?.key?.participantPn) === "string"
			? msg?.participantPn || msg?.key?.participantPn
			: "";

	m.participantLid = isLidJid(rawParticipant)
		? normJid(rawParticipant)
		: await resolveToLid(rawParticipant, { sock, idMap });

	m.participantPn =
		rawParticipantPn && !isLidJid(rawParticipantPn)
			? normJid(rawParticipantPn)
			: await resolveToPn(rawParticipant, {
					sock,
					idMap,
					pnHint: rawParticipantPn,
				});

	m.participant =
		m.participantPn || m.participantLid || normJid(rawParticipant) || "";

	let rawSender = m.fromMe
		? sock.user.id
		: m.isGroup
			? rawParticipant || m.participant
			: m.from;

	const senderPnHint =
		typeof (msg?.senderPn || msg?.key?.senderPn || rawParticipantPn) ===
		"string"
			? msg?.senderPn || msg?.key?.senderPn || rawParticipantPn
			: "";

	m.senderLid = isLidJid(rawSender)
		? normJid(rawSender)
		: await resolveToLid(rawSender, { sock, idMap });

	m.senderPn = await resolveToPn(rawSender, {
		sock,
		idMap,
		pnHint: senderPnHint,
	});

	m.sender =
		m.senderPn && !isLidJid(m.senderPn)
			? m.senderPn
			: m.senderLid || normJid(rawSender);

	m.pushName = msg.pushName;

	if (m.senderPn && m.senderLid) {
		store.updateContacts([
			{
				id: m.senderPn,
				lid: m.senderLid,
				notify: m.pushName,
				isContact: true,
			},
		]);
	}

	if (m.pushName) {
		const contact = store.getContact(m.sender);
		if (!contact || contact.notify !== m.pushName) {
			store.updateContacts([
				{ id: m.sender, notify: m.pushName, isContact: true },
			]);
		}
	}

	const senderNum = extractNumber(m.senderPn || m.sender);
	m.isOwner = !!senderNum && BOT_CONFIG.ownerJids.includes(senderNum);

	if (m.isGroup && m.metadata) {
		const sNum = extractNumber(m.senderPn || m.sender);
		m.isAdmin = m.groupAdmins.some((a) => {
			const adminPn = a.phoneNumber || a.jid || a.id;
			const adminNum = extractNumber(adminPn);
			return adminNum && sNum && adminNum === sNum;
		});

		const botPn = await resolveToPn(sock.user.id, { sock, idMap });
		const botNum = extractNumber(botPn);
		m.isBotAdmin = m.groupAdmins.some((a) => {
			const adminPn = a.phoneNumber || a.jid || a.id;
			const adminNum = extractNumber(adminPn);
			return adminNum && botNum && adminNum === botNum;
		});
	}

	if (m.message) {
		m.type = getContentType(m.message) || Object.keys(m.message)[0];

		let edited = m.message.editedMessage?.message?.protocolMessage;
		let _msgContent = edited?.editedMessage || m.message;
		_msgContent =
			m.type == "conversation" ? _msgContent : _msgContent[m.type];

		if (edited?.editedMessage) {
			m.message =
				store.loadMessage(m.from.toString(), edited.key.id).message ||
				edited.editedMessage;
			_msgContent = m.message[getContentType(m.message)];
		}

		m.msg = parseMessage(m.message[m.type]) || m.message[m.type];

		const mentioned = [
			...(m.msg?.contextInfo?.mentionedJid || []),
			...(m.msg?.contextInfo?.groupMentions?.map((v) => v.groupJid) ||
				[]),
		];

		m.mentions = (
			await Promise.all(
				mentioned.map((jid) => resolveToPn(jid, { sock, idMap }))
			)
		).map(normJid);

		m.body =
			m.msg?.text ||
			m.msg?.conversation ||
			m.msg?.caption ||
			m.message?.conversation ||
			m.msg?.selectedButtonId ||
			m.msg?.singleSelectReply?.selectedRowId ||
			m.msg?.selectedId ||
			m.msg?.contentText ||
			m.msg?.selectedDisplayText ||
			m.msg?.title ||
			m.msg?.name ||
			"";

		Object.assign(m, getPrefix(m.body, m));

		m.expiration = m.msg?.contextInfo?.expiration || 0;
		m.isMedia =
			!!m.msg?.mimetype ||
			!!m.msg?.thumbnailDirectPath ||
			!!m.msg?.jpegThumbnail;

		m.isQuoted = false;
		if (m.msg?.contextInfo?.quotedMessage) {
			m.isQuoted = true;
			m.quoted = {};
			m.quoted.message = parseMessage(m.msg.contextInfo.quotedMessage);

			if (m.quoted.message) {
				m.quoted.type =
					getContentType(m.quoted.message) ||
					Object.keys(m.quoted.message)[0];
				m.quoted.msg =
					parseMessage(m.quoted.message[m.quoted.type]) ||
					m.quoted.message[m.quoted.type];

				m.quoted.isMedia =
					!!m.quoted.msg?.mimetype ||
					!!m.quoted.msg?.thumbnailDirectPath;

				const qRemote = m.msg.contextInfo.remoteJid || m.from;
				const qParticipantRaw =
					typeof m.msg.contextInfo.participant === "string"
						? m.msg.contextInfo.participant
						: "";

				const qParticipantPnHint =
					typeof m.msg.contextInfo.participantPn === "string"
						? m.msg.contextInfo.participantPn
						: "";

				m.quoted.participantLid = isLidJid(qParticipantRaw)
					? normJid(qParticipantRaw)
					: await resolveToLid(qParticipantRaw, { sock, idMap });

				m.quoted.participantPn = await resolveToPn(qParticipantRaw, {
					sock,
					idMap,
					pnHint: qParticipantPnHint,
				});

				m.quoted.participant =
					(m.quoted.participantPn && !isLidJid(m.quoted.participantPn)
						? m.quoted.participantPn
						: m.quoted.participantLid) || normJid(qParticipantRaw);

				m.quoted.key = {
					remoteJid: qRemote,
					participant: m.quoted.participant,
					fromMe: areJidsSameUser(
						m.quoted.participant,
						sock?.user?.id
					),
					id: m.msg.contextInfo.stanzaId,
				};

				m.quoted.from = /g\.us|status/.test(qRemote)
					? m.quoted.key.participant
					: m.quoted.key.remoteJid;

				m.quoted.fromMe = m.quoted.key.fromMe;
				m.quoted.id = m.msg?.contextInfo?.stanzaId;

				m.quoted.device = /^3A/.test(m.quoted.id)
					? "ios"
					: /^3E/.test(m.quoted.id)
						? "web"
						: /^.{21}/.test(m.quoted.id)
							? "android"
							: /^.{18}/.test(m.quoted.id)
								? "desktop"
								: "unknown";

				m.quoted.isGroup = m.quoted.from.endsWith("@g.us");
				m.quoted.sender = m.quoted.participant;

				const qMentioned = [
					...(m.quoted.msg?.contextInfo?.mentionedJid || []),
					...(m.quoted.msg?.contextInfo?.groupMentions?.map(
						(v) => v.groupJid
					) || []),
				];
				m.quoted.mentions = (
					await Promise.all(
						qMentioned.map((jid) =>
							resolveToPn(jid, { sock, idMap })
						)
					)
				).map(normJid);

				m.quoted.body =
					m.quoted.msg?.text ||
					m.quoted.msg?.caption ||
					m.quoted?.message?.conversation ||
					m.quoted.msg?.selectedButtonId ||
					m.quoted.msg?.singleSelectReply?.selectedRowId ||
					m.quoted.msg?.selectedId ||
					m.quoted.msg?.contentText ||
					m.quoted.msg?.selectedDisplayText ||
					m.quoted.msg?.title ||
					m.quoted?.msg?.name ||
					"";

				m.quoted.prefix = new RegExp(
					"^[°•π÷×¶∆£¢€¥®™+✓=|/~!?@#%^&.©^]",
					"gi"
				).test(m.quoted.body)
					? m.quoted.body.match(
							new RegExp("^[°•π÷×¶∆£¢€¥®™+✓=|/~!?@#%^&.©^]", "gi")
						)[0]
					: "";

				m.quoted.command =
					m.quoted.body &&
					m.quoted.body
						.replace(m.quoted.prefix, "")
						.trim()
						.split(/ +/)
						.shift();

				m.quoted.text =
					m.quoted.message?.conversation ||
					m.quoted.message[m.quoted.type]?.text ||
					m.quoted.message[m.quoted.type]?.description ||
					m.quoted.message[m.quoted.type]?.caption ||
					m.quoted.message[m.quoted.type]?.hydratedTemplate
						?.hydratedContentText ||
					"";

				m.quoted.url =
					(m.quoted.text.match(
						/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi
					) || [])[0] || "";

				const quotedNum = extractNumber(
					m.quoted.participantPn || m.quoted.sender
				);
				m.quoted.isOwner =
					!!quotedNum && BOT_CONFIG.ownerJids.includes(quotedNum);

				m.quoted.isBot = m.quoted.id
					? (m.quoted.id.startsWith("BAE5") &&
							m.quoted.id.length === 16) ||
						(m.quoted.id.startsWith("3EB0") &&
							m.quoted.id.length === 12) ||
						(m.quoted.id.startsWith("3EB0") &&
							m.quoted.id.length === 20) ||
						(m.quoted.id.startsWith("B24E") &&
							m.quoted.id.length === 20)
					: false;

				m.quoted.download = async () =>
					await sock.downloadMedia(m.quoted);
				m.quoted.delete = () =>
					sock.sendMessage(m.from, { delete: m.quoted.key });

				let vM = (m.quoted.fakeObj = WAProto.WebMessageInfo.fromObject({
					key: {
						fromMe: m.quoted.fromMe,
						remoteJid: m.quoted.from,
						id: m.quoted.id,
					},
					message: m.quoted.message,
					...(m.isGroup ? { participant: m.quoted.sender } : {}),
				}));

				m.getQuotedObj = m.getQuotedMessage = async () => {
					if (!m.quoted.id) {
						return null;
					}
					let q = WAProto.WebMessageInfo.fromObject(
						(await store.loadMessage(m.from, m.quoted.id)) || vM
					);
					return await serialize(sock, q, store);
				};
			}
		}
	}

	m.reply = async (text, options = {}) => {
		let chatId = options?.from ? options.from : m.from;
		let quoted = options?.quoted ? options.quoted : m;

		if (
			Buffer.isBuffer(text) ||
			/^data:.?\/.*?;base64,/i.test(text) ||
			/^https?:\/\//.test(text) ||
			existsSync(text)
		) {
			let data = await Func.getFile(text);
			if (
				!options.mimetype &&
				(/utf-8|json/i.test(data.mime) ||
					data.ext == ".bin" ||
					!data.ext)
			) {
				return sock.sendMessage(
					chatId,
					{
						text: data.data.toString(),
						mentions: [
							m.sender,
							...safeParseMention(sock, data.data.toString()),
						],
						...options,
					},
					{
						quoted,
						ephemeralExpiration: m.expiration,
						messageId: randomId(32),
						...options,
					}
				);
			}
			return sock.sendMedia(chatId, data.data, quoted, {
				ephemeralExpiration: m.expiration,
				messageId: randomId(32),
				...options,
			});
		}

		if (typeof text === "object" && !Array.isArray(text)) {
			return sock.sendMessage(
				chatId,
				{
					...text,
					mentions: [
						m.sender,
						...safeParseMention(sock, JSON.stringify(text)),
					],
					...options,
				},
				{
					quoted,
					ephemeralExpiration: m.expiration,
					messageId: randomId(32),
					...options,
				}
			);
		}

		if (typeof text === "string") {
			return sock.sendMessage(
				chatId,
				{
					text,
					mentions: [m.sender, ...safeParseMention(sock, text)],
					...options,
				},
				{
					quoted,
					ephemeralExpiration: m.expiration,
					messageId: randomId(32),
					...options,
				}
			);
		}
	};

	m.react = (emoji) => {
		try {
			return sock.sendMessage(m.from, {
				react: { text: String(emoji), key: m.key },
			});
		} catch (error) {
			console.error("Failed to send reaction:", error);
		}
	};

	m.delete = () => {
		try {
			return sock.sendMessage(m.from, { delete: m.key });
		} catch (error) {
			console.error("Failed to delete message:", error);
		}
	};

	m.download = async () => await sock.downloadMedia(m);

	m.isUrl =
		((m.body &&
			m.body.match(
				/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi
			)) ||
			[])[0] || "";

	return m;
}
