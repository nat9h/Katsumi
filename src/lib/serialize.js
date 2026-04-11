import { BOT_CONFIG } from "#config/index";
import * as Func from "#lib/functions";
import { getPrefix } from "#lib/prefix";
import Sticker from "#lib/sticker";
import { to_audio } from "#utils/converter";
import {
	areJidsSameUser,
	chatModificationToAppPatch,
	downloadMediaMessage,
	extractMessageContent,
	generateForwardMessageContent,
	generateWAMessage,
	generateWAMessageContent,
	generateWAMessageFromContent,
	getContentType,
	jidDecode,
	jidNormalizedUser,
	proto,
} from "baileys";
import { fileTypeFromBuffer } from "file-type";
import { randomBytes } from "node:crypto";
import { existsSync, promises, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Generate a random hexadecimal ID.
 *
 * @param {number} [length=16] Number of random bytes to generate.
 * @returns {string} Random hexadecimal string.
 */
const randomId = (length = 16) => randomBytes(length).toString("hex");

/**
 * Extract a phone-like numeric sequence from a JID.
 *
 * @param {string | null | undefined} jid WhatsApp JID.
 * @returns {string | null} Extracted number or null if none is found.
 */
const extractNumber = (jid) => (jid?.match(/\d{8,}/) || [])[0] || null;

/**
 * Check whether a JID is a LID-based JID.
 *
 * @param {string | null | undefined} jid WhatsApp JID.
 * @returns {boolean} True if the JID is a LID JID.
 */
const isLidJid = (jid) =>
	typeof jid === "string" && /@lid$|@hosted\.lid$/.test(jid);

/**
 * Normalize a JID using Baileys utilities.
 *
 * @param {string | null | undefined} jid WhatsApp JID.
 * @returns {string | null | undefined} Normalized JID.
 */
const normJid = (jid) => (jid ? jidNormalizedUser(jid) : jid);

/**
 * Format a phone number into a more readable representation.
 * Currently supports basic Indonesian (+62) and US/Canada (+1) formatting.
 *
 * @param {string | number} number Raw phone number input.
 * @returns {string} Formatted phone number.
 */
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
	return String(number);
};

/**
 * Resolve identities between phone-number JIDs and LID JIDs.
 */
class IdentityResolver {
	/**
	 * @param {any} sock Baileys socket instance.
	 * @param {{ lidToPn?: Record<string, string>, pnToLid?: Record<string, string> }} [idMap]
	 */
	constructor(sock, idMap = { lidToPn: {}, pnToLid: {} }) {
		this.sock = sock;
		this.idMap = idMap;
	}

	/**
	 * Build a bidirectional identity map from group participants metadata.
	 *
	 * @param {Array<any>} [participants=[]] Group participants list.
	 * @returns {{ lidToPn: Record<string, string>, pnToLid: Record<string, string> }}
	 */
	static buildIdentityMap(participants = []) {
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
			} else if (lid && isLidJid(lid)) {
				pnToLid[id] = lid;
			}
		}

		return { lidToPn, pnToLid };
	}

	/**
	 * Resolve a JID to its phone-number form when possible.
	 *
	 * @param {string | null | undefined} jid JID to resolve.
	 * @param {string | null | undefined} [pnHint=null] Optional phone-number hint.
	 * @returns {Promise<string | null | undefined>}
	 */
	async resolveToPn(jid, pnHint = null) {
		jid = normJid(jid);
		pnHint = normJid(pnHint);

		if (!jid || !isLidJid(jid)) {
			return jid;
		}
		if (pnHint && !isLidJid(pnHint)) {
			return pnHint;
		}

		const fromMeta = this.idMap?.lidToPn?.[jid];
		if (fromMeta) {
			return fromMeta;
		}

		const store = this.sock?.signalRepository?.lidMapping;
		if (store?.getPNForLID) {
			const pn = await store.getPNForLID(jid);
			if (pn) {
				return normJid(pn);
			}
		}

		return jid;
	}

	/**
	 * Resolve a JID to its LID form when possible.
	 *
	 * @param {string | null | undefined} jid JID to resolve.
	 * @param {string | null | undefined} [lidHint=null] Optional LID hint.
	 * @returns {Promise<string | null | undefined>}
	 */
	async resolveToLid(jid, lidHint = null) {
		jid = normJid(jid);
		lidHint = normJid(lidHint);

		if (!jid || isLidJid(jid)) {
			return jid;
		}
		if (lidHint && isLidJid(lidHint)) {
			return lidHint;
		}

		const fromMeta = this.idMap?.pnToLid?.[jid];
		if (fromMeta) {
			return fromMeta;
		}

		const store = this.sock?.signalRepository?.lidMapping;
		if (store?.getLIDForPN) {
			const lid = await store.getLIDForPN(jid);
			if (lid) {
				return normJid(lid);
			}
		}

		return jid;
	}

	/**
	 * Resolve a list of mentioned JIDs to phone-number JIDs when possible.
	 *
	 * @param {string[]} jids Mentioned JIDs.
	 * @returns {Promise<string[]>}
	 */
	async resolveMentions(jids) {
		const resolved = await Promise.all(
			jids.map((jid) => this.resolveToPn(jid))
		);
		return resolved.map(normJid);
	}
}

/**
 * Utility helpers for extracting and interpreting message content.
 */
class MessageParser {
	/**
	 * Unwrap nested Baileys message containers and return the effective content.
	 *
	 * @param {any} content Raw message content.
	 * @returns {any} Parsed message payload.
	 */
	static parseContent(content) {
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
	}

	/**
	 * Extract a human-readable message body from multiple possible fields.
	 *
	 * @param {any} msg Parsed message node.
	 * @param {any} message Root message object.
	 * @returns {string}
	 */
	static extractBody(msg, message) {
		return (
			msg?.text ||
			msg?.conversation ||
			msg?.caption ||
			message?.conversation ||
			msg?.selectedButtonId ||
			msg?.singleSelectReply?.selectedRowId ||
			msg?.selectedId ||
			msg?.contentText ||
			msg?.selectedDisplayText ||
			msg?.title ||
			msg?.name ||
			""
		);
	}

	/**
	 * Test whether a string contains a URL.
	 *
	 * @param {string} [text=""] Input text.
	 * @returns {boolean}
	 */
	static isUrl(text = "") {
		return /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi.test(
			String(text)
		);
	}

	/**
	 * Guess the sender device type from a WhatsApp message ID.
	 *
	 * @param {string | undefined} id Message ID.
	 * @returns {"ios" | "web" | "android" | "desktop" | "unknown"}
	 */
	static detectDevice(id) {
		if (!id) {
			return "unknown";
		}
		if (/^3A/.test(id)) {
			return "ios";
		}
		if (/^3EB/.test(id)) {
			return "web";
		}
		if (/^.{21}/.test(id)) {
			return "android";
		}
		if (/^.{18}/.test(id)) {
			return "desktop";
		}
		return "unknown";
	}

	/**
	 * Detect whether a message ID likely belongs to a bot-generated message.
	 *
	 * @param {string | undefined} id Message ID.
	 * @returns {boolean}
	 */
	static isBotId(id) {
		if (!id) {
			return false;
		}
		return (
			(id.startsWith("BAE5") && id.length === 16) ||
			(id.startsWith("B24E") && id.length === 20)
		);
	}

	/**
	 * Extract a command prefix from the beginning of a message body.
	 *
	 * @param {string} body Message body.
	 * @returns {string}
	 */
	static extractPrefix(body) {
		const match = body?.match(/^[°•π÷×¶∆£¢€¥®™+✓=|/~!?@#%^&.©^]/gi);
		return match ? match[0] : "";
	}
}

/**
 * Extend the Baileys socket with convenience helpers.
 */
class ClientExtensions {
	/**
	 * Attach helper methods to a socket instance.
	 *
	 * @param {any} sock Baileys socket.
	 * @param {any} store Local store instance.
	 * @returns {any} Extended socket.
	 */
	static extend(sock, store) {
		Object.defineProperties(sock, {
			sendAlbum: {
				/**
				 * Send an album message and then relay each media item into it.
				 *
				 * @param {string} jid Target JID.
				 * @param {Array<any>} array Array of media message payloads.
				 * @param {any} quoted Quoted message.
				 * @returns {Promise<any>}
				 */
				async value(jid, array, quoted) {
					const album = generateWAMessageFromContent(
						jid,
						{
							messageContextInfo: {
								messageSecret: randomBytes(32),
							},
							albumMessage: {
								expectedImageCount: array.filter((a) =>
									Object.prototype.hasOwnProperty.call(
										a,
										"image"
									)
								).length,
								expectedVideoCount: array.filter((a) =>
									Object.prototype.hasOwnProperty.call(
										a,
										"video"
									)
								).length,
							},
						},
						{
							userJid: sock.user.id,
							quoted,
							upload: sock.waUploadToServer,
						}
					);

					await sock.relayMessage(
						album.key.remoteJid,
						album.message,
						{
							messageId: album.key.id,
						}
					);

					for (const content of array) {
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
						await sock.relayMessage(
							img.key.remoteJid,
							img.message,
							{
								messageId: img.key.id,
							}
						);
					}

					return album;
				},
				enumerable: true,
			},

			clearChat: {
				/**
				 * Clear chat history using an app patch.
				 *
				 * @param {string} jid Chat JID.
				 * @param {Array<any>} messages Messages included in the clear range.
				 * @returns {Promise<any>}
				 */
				async value(jid, messages) {
					const msg = messages[messages.length - 1];
					const patch = chatModificationToAppPatch(
						{ clear: true },
						jid
					);
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
				/**
				 * Send status mentions into multiple groups.
				 *
				 * @param {string[]} groupIds Group JIDs.
				 * @param {any} content Message content.
				 * @param {any} [opts={}] Generation options.
				 * @returns {Promise<string[]>}
				 */
				async value(groupIds, content, opts = {}) {
					const sent = [];
					for (const gid of groupIds) {
						const messageSecret = randomBytes(32);
						const inside = await generateWAMessageContent(content, {
							upload: sock.waUploadToServer,
							...(opts.generate || {}),
						});
						const msg = generateWAMessageFromContent(
							gid,
							{
								messageContextInfo: { messageSecret },
								groupStatusMessageV2: {
									message: {
										...inside,
										messageContextInfo: { messageSecret },
									},
								},
							},
							{ userJid: sock.user.id }
						);
						await sock.relayMessage(gid, msg.message, {
							messageId: msg.key.id,
						});
						sent.push(gid);
					}
					return sent;
				},
			},

			decodeJid: {
				/**
				 * Decode a device-specific JID into a normalized user@server form.
				 *
				 * @param {string} jid Raw JID.
				 * @returns {string}
				 */
				value(jid) {
					if (!jid || !/:\d+@/gi.test(jid)) {
						return jid;
					}
					const decode = jidDecode(jid) || {};
					return (
						(decode.user &&
							decode.server &&
							`${decode.user}@${decode.server}`) ||
						jid
					);
				},
			},

			getName: {
				/**
				 * Get a display name for a JID.
				 *
				 * @param {string} jid WhatsApp JID.
				 * @returns {string}
				 */
				value(jid) {
					const id = jidNormalizedUser(jid);
					if (id.endsWith("g.us")) {
						return store.getGroupMetadata(id)?.subject || id;
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
				/**
				 * Send one or more WhatsApp contacts as vcards.
				 *
				 * @param {string} jid Target JID.
				 * @param {string[]} numbers Contact numbers/JIDs.
				 * @param {any} quoted Quoted message.
				 * @param {any} [options={}] Additional send options.
				 * @returns {Promise<any>}
				 */
				async value(jid, numbers, quoted, options = {}) {
					const list = numbers
						.filter((v) => !v.endsWith("g.us"))
						.map((v) => {
							const cleaned = v.replace(/\D+/g, "");
							const contactJid = `${cleaned}@s.whatsapp.net`;
							const name = sock.getName(contactJid);
							return {
								displayName: name,
								vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${name}\nFN:${name}\nitem1.TEL;waid=${cleaned}:${cleaned}\nEND:VCARD`,
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
				/**
				 * Parse @mentions into WhatsApp JIDs.
				 *
				 * @param {string} text Input text.
				 * @returns {string[]}
				 */
				value(text) {
					return (
						[...text.matchAll(/@([0-9]{5,16}|0)/g)].map(
							(v) => v[1] + "@s.whatsapp.net"
						) || []
					);
				},
			},

			downloadMedia: {
				/**
				 * Download media from a message.
				 *
				 * @param {any} message Message containing media.
				 * @param {string} [filename] Optional output filename without extension.
				 * @returns {Promise<Buffer | string>} Buffer or saved file path.
				 */
				async value(message, filename) {
					const media = await downloadMediaMessage(
						message,
						"buffer",
						{},
						{
							reuploadRequest: sock.updateMediaMessage,
						}
					);

					if (filename) {
						const mime = await fileTypeFromBuffer(media);
						const filePath = join(
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
				/**
				 * Send media from a URL, buffer, or local file path.
				 *
				 * @param {string} jid Target JID.
				 * @param {string | Buffer} url Media source.
				 * @param {any} [quoted=""] Quoted message.
				 * @param {any} [options={}] Additional send options.
				 * @returns {Promise<any>}
				 */
				async value(jid, url, quoted = "", options = {}) {
					const {
						mime,
						data: buffer,
						ext,
						size,
					} = await Func.getFile(url);
					const mimetype =
						options?.mimetype ||
						(/audio/i.test(mime) ? "audio/mpeg" : mime);

					let data = { text: "" };

					if (size > 45000000 || options.asDocument) {
						data = {
							document: buffer,
							mimetype: mime,
							fileName:
								options?.fileName ||
								`Natsumi_(${new Date()}).${ext}`,
							...options,
						};
					} else if (options.asSticker || /webp/.test(mime)) {
						const pathFile = await Sticker.create(
							{ mimetype, data: buffer },
							options
						);
						data = {
							sticker: readFileSync(pathFile),
							mimetype: "image/webp",
							...options,
						};
						if (existsSync(pathFile)) {
							await promises.unlink(pathFile);
						}
					} else if (/image/.test(mime)) {
						data = {
							image: buffer,
							mimetype: options?.mimetype || "image/png",
							...options,
						};
					} else if (/video/.test(mime)) {
						data = {
							video: buffer,
							mimetype: options?.mimetype || "video/mp4",
							...options,
						};
					} else if (/audio/.test(mime)) {
						data = {
							audio: await to_audio(buffer, "mp3"),
							mimetype: options?.mimetype || "audio/mpeg",
							...options,
						};
					} else {
						data = { document: buffer, mimetype: mime, ...options };
					}

					return sock.sendMessage(jid, data, {
						quoted,
						messageId: randomId(32),
						...options,
					});
				},
				enumerable: true,
			},

			cMod: {
				/**
				 * Clone and modify an existing message.
				 *
				 * @param {string} jid Destination JID.
				 * @param {any} copy Original message object.
				 * @param {string} [text=""] Replacement text.
				 * @param {string} [sender=sock.user.id] Sender JID override.
				 * @param {any} [options={}] Additional content overrides.
				 * @returns {any}
				 */
				value(
					jid,
					copy,
					text = "",
					sender = sock.user.id,
					options = {}
				) {
					const mtype = getContentType(copy.message);
					let content = copy.message[mtype];

					if (typeof content === "string") {
						copy.message[mtype] = text || content;
					} else if (content.caption) {
						content.caption = text || content.caption;
					} else if (content.text) {
						content.text = text || content.text;
					}

					if (typeof content !== "string") {
						copy.message[mtype] = {
							...content,
							...options,
							contextInfo: {
								...(content.contextInfo || {}),
								mentionedJid:
									options.mentions ||
									content.contextInfo?.mentionedJid ||
									[],
							},
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
					return proto.WebMessageInfo.fromObject(copy);
				},
			},

			getGroupMentionJids: {
				/**
				 * Get a deduplicated list of participant JIDs suitable for mentions.
				 *
				 * @param {any} metadata Group metadata.
				 * @param {{ preferPn?: boolean }} [opts={}] Resolution options.
				 * @returns {Promise<string[]>}
				 */
				async value(metadata, opts = {}) {
					const preferPn = opts.preferPn !== false;
					const isPn = (jid) =>
						typeof jid === "string" &&
						jid.endsWith("@s.whatsapp.net");

					const participants = metadata?.participants || [];
					const idMap =
						IdentityResolver.buildIdentityMap(participants);
					const resolver = new IdentityResolver(sock, idMap);
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

						let chosen = preferPn
							? await resolver.resolveToPn(base)
							: base;
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
				/**
				 * Forward a message while optionally increasing forwarding score.
				 *
				 * @param {string} jid Destination JID.
				 * @param {any} message Original message.
				 * @param {boolean | number} [forwardingScore=true] Forward flag or extra score.
				 * @param {any} [options={}] Additional send options.
				 * @returns {Promise<any>}
				 */
				async value(
					jid,
					message,
					forwardingScore = true,
					options = {}
				) {
					const m = generateForwardMessageContent(
						message,
						!!forwardingScore
					);
					const mtype = Object.keys(m)[0];

					if (
						typeof forwardingScore === "number" &&
						forwardingScore > 1
					) {
						m[mtype].contextInfo.forwardingScore += forwardingScore;
					}

					const preparedMessage = generateWAMessageFromContent(
						jid,
						m,
						{
							...options,
							userJid: sock.user.id,
						}
					);

					await sock.relayMessage(jid, preparedMessage.message, {
						messageId: preparedMessage.key.id,
						additionalAttributes: { ...options },
					});

					return preparedMessage;
				},
				enumerable: true,
			},
		});

		return sock;
	}
}

/**
 * Build a normalized quoted-message object from message context info.
 */
class QuotedMessageBuilder {
	/**
	 * @param {any} sock Baileys socket.
	 * @param {IdentityResolver} resolver Identity resolver instance.
	 * @param {any} parentMessage Parent serialized message.
	 * @param {any} contextInfo Baileys contextInfo.
	 * @param {string} from Source chat JID.
	 * @returns {Promise<any | null>}
	 */
	static async build(sock, resolver, parentMessage, contextInfo, from) {
		const quoted = {};
		quoted.message = MessageParser.parseContent(contextInfo.quotedMessage);
		if (!quoted.message) {
			return null;
		}

		quoted.type =
			getContentType(quoted.message) || Object.keys(quoted.message)[0];
		quoted.msg =
			MessageParser.parseContent(quoted.message[quoted.type]) ||
			quoted.message[quoted.type];
		quoted.isMedia =
			!!quoted.msg?.mimetype || !!quoted.msg?.thumbnailDirectPath;

		const qParticipantRaw =
			typeof contextInfo.participant === "string"
				? contextInfo.participant
				: "";
		const qParticipantPnHint =
			typeof contextInfo.participantPn === "string"
				? contextInfo.participantPn
				: "";

		quoted.participantLid = isLidJid(qParticipantRaw)
			? normJid(qParticipantRaw)
			: await resolver.resolveToLid(qParticipantRaw);

		quoted.participantPn = await resolver.resolveToPn(
			qParticipantRaw,
			qParticipantPnHint
		);
		quoted.participant =
			(quoted.participantPn && !isLidJid(quoted.participantPn)
				? quoted.participantPn
				: quoted.participantLid) || normJid(qParticipantRaw);

		const qRemote = contextInfo.remoteJid || from;
		quoted.key = {
			remoteJid: qRemote,
			participant: quoted.participant,
			fromMe: areJidsSameUser(quoted.participant, sock?.user?.id),
			id: contextInfo.stanzaId,
		};

		quoted.from = /g\.us|status/.test(qRemote)
			? quoted.key.participant
			: quoted.key.remoteJid;
		quoted.fromMe = quoted.key.fromMe;
		quoted.id = contextInfo.stanzaId;
		quoted.device = MessageParser.detectDevice(quoted.id);
		quoted.isGroup = quoted.from.endsWith("@g.us");
		quoted.sender = quoted.participant;

		const qMentioned = [
			...(quoted.msg?.contextInfo?.mentionedJid || []),
			...(quoted.msg?.contextInfo?.groupMentions?.map(
				(v) => v.groupJid
			) || []),
		];
		quoted.mentions = await resolver.resolveMentions(qMentioned);

		quoted.body = MessageParser.extractBody(quoted.msg, quoted.message);
		quoted.prefix = MessageParser.extractPrefix(quoted.body);
		quoted.command =
			quoted.body
				?.replace(quoted.prefix, "")
				.trim()
				.split(/ +/)
				.shift() || "";

		quoted.text =
			quoted.message?.conversation ||
			quoted.message[quoted.type]?.text ||
			quoted.message[quoted.type]?.description ||
			quoted.message[quoted.type]?.caption ||
			quoted.message[quoted.type]?.hydratedTemplate
				?.hydratedContentText ||
			"";

		quoted.url =
			(quoted.text.match(
				/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi
			) || [])[0] || "";

		const quotedNum = extractNumber(quoted.participantPn || quoted.sender);
		quoted.isOwner =
			!!quotedNum && BOT_CONFIG.ownerJids.includes(quotedNum);
		quoted.isBot = quoted.id
			? (quoted.id.startsWith("BAE5") && quoted.id.length === 16) ||
				(quoted.id.startsWith("3EB0") &&
					(quoted.id.length === 12 || quoted.id.length === 20)) ||
				(quoted.id.startsWith("B24E") && quoted.id.length === 20)
			: false;

		quoted.download = () => sock.downloadMedia(quoted);
		quoted.delete = () =>
			sock.sendMessage(parentMessage.from, { delete: quoted.key });

		quoted.fakeObj = proto.WebMessageInfo.fromObject({
			key: {
				fromMe: quoted.fromMe,
				remoteJid: quoted.from,
				id: quoted.id,
			},
			message: quoted.message,
			...(parentMessage.isGroup ? { participant: quoted.sender } : {}),
		});

		return quoted;
	}
}

/**
 * Build a normalized serialized message object from a raw Baileys message.
 */
class SerializedMessageBuilder {
	/**
	 * Create a serialized message wrapper with convenience fields and helpers.
	 *
	 * @param {any} sock Baileys socket.
	 * @param {any} store Store instance.
	 * @param {any} msg Raw Baileys message.
	 * @returns {Promise<any | null>}
	 */
	static async build(sock, store, msg) {
		if (!msg || !msg.message) {
			return msg ?? null;
		}

		const m = {
			sock,
			isClonebot: sock.isClonebot || false,
		};

		m.message = MessageParser.parseContent(msg.message);
		m.messageTimestamp =
			msg.messageTimestamp || msg.key?.timestamp || Date.now() / 1000;

		if (msg.key) {
			m.key = msg.key;
			m.from = m.key.remoteJid.startsWith("status")
				? normJid(m.key?.participant || msg.participant)
				: normJid(m.key.remoteJid);
			m.fromMe = !!m.key.fromMe;
			m.id = m.key.id;
			m.device = MessageParser.detectDevice(m.id);
			m.isBot = MessageParser.isBotId(m.id);
			m.isGroup = m.from.endsWith("@g.us");
		}

		let idMap = { lidToPn: {}, pnToLid: {} };

		if (m.isGroup) {
			const { metadata, map } =
				await SerializedMessageBuilder.#loadGroupMetadata(
					sock,
					store,
					m.from
				);
			m.metadata = metadata;
			idMap = map;
			m.groupAdmins = metadata
				? metadata.participants
						.filter((p) => p.admin)
						.map((p) => ({
							id: p.id,
							jid: p.jid,
							phoneNumber: p.phoneNumber,
							lid: p.lid,
							admin: p.admin,
						}))
				: [];
		} else {
			m.metadata = null;
			m.groupAdmins = [];
		}

		m._idMap = idMap;
		m.isAdmin = false;
		m.isBotAdmin = false;

		const resolver = new IdentityResolver(sock, idMap);
		await SerializedMessageBuilder.#resolveParticipants(m, msg, resolver);
		SerializedMessageBuilder.#updateContacts(store, m);
		await SerializedMessageBuilder.#checkPermissions(m, sock, resolver);
		await SerializedMessageBuilder.#parseMessageContent(
			m,
			sock,
			store,
			resolver
		);
		SerializedMessageBuilder.#attachMethods(m, sock);

		return m;
	}

	/**
	 * Load group metadata and build identity mappings.
	 *
	 * @param {any} sock Baileys socket.
	 * @param {any} store Store instance.
	 * @param {string} from Group JID.
	 * @returns {Promise<{ metadata: any, map: { lidToPn: Record<string, string>, pnToLid: Record<string, string> } }>}
	 */
	static async #loadGroupMetadata(sock, store, from) {
		let metadata = store.getGroupMetadata(from);
		if (!metadata) {
			try {
				metadata = await sock.groupMetadata(from);
				store.setGroupMetadata(from, metadata);
			} catch {
				metadata = null;
			}
		}

		let idMap = { lidToPn: {}, pnToLid: {} };
		if (metadata?.participants?.length) {
			metadata.participants = metadata.participants.map((p) => ({
				...p,
				id: normJid(p.id || p.jid),
				jid: normJid(p.jid),
				phoneNumber: normJid(p.phoneNumber),
				lid: normJid(p.lid),
			}));
			idMap = IdentityResolver.buildIdentityMap(metadata.participants);
		}

		return { metadata, map: idMap };
	}

	/**
	 * Resolve participant and sender identities.
	 *
	 * @param {any} m Serialized message.
	 * @param {any} msg Raw Baileys message.
	 * @param {IdentityResolver} resolver Identity resolver.
	 * @returns {Promise<void>}
	 */
	static async #resolveParticipants(m, msg, resolver) {
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
			: await resolver.resolveToLid(rawParticipant);

		m.participantPn =
			rawParticipantPn && !isLidJid(rawParticipantPn)
				? normJid(rawParticipantPn)
				: await resolver.resolveToPn(rawParticipant, rawParticipantPn);

		m.participant =
			m.participantPn ||
			m.participantLid ||
			normJid(rawParticipant) ||
			"";

		const rawSender = m.fromMe
			? m.sock.user.id
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
			: await resolver.resolveToLid(rawSender);

		m.senderPn = await resolver.resolveToPn(rawSender, senderPnHint);
		m.sender =
			m.senderPn && !isLidJid(m.senderPn)
				? m.senderPn
				: m.senderLid || normJid(rawSender);

		m.pushName = msg.pushName;
	}

	/**
	 * Update local contacts cache from resolved sender information.
	 *
	 * @param {any} store Store instance.
	 * @param {any} m Serialized message.
	 * @returns {void}
	 */
	static #updateContacts(store, m) {
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
	}

	/**
	 * Check ownership and admin permissions.
	 *
	 * @param {any} m Serialized message.
	 * @param {any} sock Baileys socket.
	 * @param {IdentityResolver} resolver Identity resolver.
	 * @returns {Promise<void>}
	 */
	static async #checkPermissions(m, sock, resolver) {
		const senderNum = extractNumber(m.senderPn || m.sender);
		m.isOwner = !!senderNum && BOT_CONFIG.ownerJids.includes(senderNum);

		if (m.isGroup && m.metadata) {
			const sNum = extractNumber(m.senderPn || m.sender);
			m.isAdmin = m.groupAdmins.some((a) => {
				const adminNum = extractNumber(a.phoneNumber || a.jid || a.id);
				return adminNum && sNum && adminNum === sNum;
			});

			const botPn = await resolver.resolveToPn(sock.user.id);
			const botNum = extractNumber(botPn);
			m.isBotAdmin = m.groupAdmins.some((a) => {
				const adminNum = extractNumber(a.phoneNumber || a.jid || a.id);
				return adminNum && botNum && adminNum === botNum;
			});
		}
	}

	/**
	 * Parse message content, quoted content, mentions, and derived flags.
	 *
	 * @param {any} m Serialized message.
	 * @param {any} sock Baileys socket.
	 * @param {any} store Store instance.
	 * @param {IdentityResolver} resolver Identity resolver.
	 * @returns {Promise<void>}
	 */
	static async #parseMessageContent(m, sock, store, resolver) {
		if (!m.message) {
			return;
		}

		m.type = getContentType(m.message) || Object.keys(m.message)[0];

		const edited = m.message.editedMessage?.message?.protocolMessage;
		if (edited?.editedMessage) {
			m.message =
				store.loadMessage(m.from.toString(), edited.key.id)?.message ||
				edited.editedMessage;
		}

		m.msg =
			MessageParser.parseContent(m.message[m.type]) || m.message[m.type];

		const mentioned = [
			...(m.msg?.contextInfo?.mentionedJid || []),
			...(m.msg?.contextInfo?.groupMentions?.map((v) => v.groupJid) ||
				[]),
		];
		m.mentions = await resolver.resolveMentions(mentioned);

		m.body = MessageParser.extractBody(m.msg, m.message);
		Object.assign(m, getPrefix(m.body, m));

		m.expiration = m.msg?.contextInfo?.expiration || 0;
		m.isMedia =
			!!m.msg?.mimetype ||
			!!m.msg?.thumbnailDirectPath ||
			!!m.msg?.jpegThumbnail;

		m.url =
			(m.body.match(
				/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi
			) || [])[0] || "";

		m.isQuoted = false;
		if (m.msg?.contextInfo?.quotedMessage) {
			m.isQuoted = true;

			const quoted = await QuotedMessageBuilder.build(
				sock,
				resolver,
				m,
				m.msg.contextInfo,
				m.from
			);

			if (quoted) {
				m.quoted = quoted;
				m.getQuotedObj = m.getQuotedMessage = async () => {
					if (!m.quoted.id) {
						return null;
					}
					const qMsg = proto.WebMessageInfo.fromObject(
						store.loadMessage(m.from, m.quoted.id) ||
							m.quoted.fakeObj
					);
					return SerializedMessageBuilder.build(sock, store, qMsg);
				};
			}
		}
	}

	/**
	 * Attach convenience instance methods to the serialized message.
	 *
	 * @param {any} m Serialized message.
	 * @param {any} sock Baileys socket.
	 * @returns {void}
	 */
	static #attachMethods(m, sock) {
		const safeParseMention = (text) =>
			typeof sock.parseMention === "function"
				? sock.parseMention(text)
				: [];

		/**
		 * Reply to the current message.
		 *
		 * @param {string | Buffer | object} text Reply payload.
		 * @param {any} [options={}] Send options.
		 * @returns {Promise<any>}
		 */
		m.reply = async (text, options = {}) => {
			const chatId = options?.from || m.from;
			const quoted = options?.quoted || m;

			if (
				Buffer.isBuffer(text) ||
				/^data:.?\/.*?;base64,/i.test(text) ||
				/^https?:\/\//.test(text) ||
				existsSync(text)
			) {
				const data = await Func.getFile(text);
				if (
					!options.mimetype &&
					(/utf-8|json/i.test(data.mime) ||
						data.ext === ".bin" ||
						!data.ext)
				) {
					return sock.sendMessage(
						chatId,
						{
							text: data.data.toString(),
							mentions: [
								m.sender,
								...safeParseMention(data.data.toString()),
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
							...safeParseMention(JSON.stringify(text)),
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

			return sock.sendMessage(
				chatId,
				{
					text,
					mentions: [m.sender, ...safeParseMention(text)],
					...options,
				},
				{
					quoted,
					ephemeralExpiration: m.expiration,
					messageId: randomId(32),
					...options,
				}
			);
		};

		/**
		 * React to the current message.
		 *
		 * @param {string} emoji Reaction emoji.
		 * @returns {Promise<any>}
		 */
		m.react = (emoji) =>
			sock
				.sendMessage(m.from, {
					react: { text: String(emoji), key: m.key },
				})
				.catch(console.error);

		/**
		 * Delete the current message.
		 *
		 * @returns {Promise<any>}
		 */
		m.delete = () =>
			sock.sendMessage(m.from, { delete: m.key }).catch(console.error);

		/**
		 * Download media from the current message.
		 *
		 * @returns {Promise<Buffer | string>}
		 */
		m.download = () => sock.downloadMedia(m);

		/**
		 * Check whether a string contains a URL.
		 *
		 * @param {string} [text=""] Input text.
		 * @returns {boolean}
		 */
		m.isUrl = (text = "") => MessageParser.isUrl(text);
	}
}

/**
 * Extend the socket with custom helper methods.
 *
 * @param {{ sock: any, store: any }} param0 Socket and store container.
 * @returns {any}
 */
export function Client({ sock, store }) {
	return ClientExtensions.extend(sock, store);
}

/**
 * Serialize a raw Baileys message into a normalized helper-rich object.
 *
 * @param {any} sock Baileys socket.
 * @param {any} msg Raw incoming message.
 * @param {any} store Message/contact/group store.
 * @returns {Promise<any | null>}
 */
export default async function serialize(sock, msg, store) {
	return SerializedMessageBuilder.build(sock, store, msg);
}
