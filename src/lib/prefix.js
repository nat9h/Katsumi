import { BOT_CONFIG } from "../config/index.js";

export let allCmd = [];

export function setAllCommands(list) {
	allCmd = (list || []).map((cmd) => cmd.toLowerCase());
}

/*
 * Determines the prefix for a given message body and sender.
 * Owner can use no-prefix or prefix, regular users must use a prefix.
 *
 * @param {string} body - The message body.Add commentMore actions
 * @param {string} senderJid - The JID of the sender (e.g., "6285175106460@s.whatsapp.net").
 * @returns {{prefix: string, isCommand: boolean, command: string, args: string[], text: string}} An object containing prefix, isCommand, command, args, and text.
 */
export function getPrefix(body, m) {
	const isOwner = m.isOwner;
	const prefixes = (BOT_CONFIG.prefixes || []).filter(Boolean);

	let prefix = "";
	let isCommand = false;
	let command = "";
	let args = [];
	let text = "";

	if (!body) {
		return { prefix, isCommand, command, args, text };
	}

	const sortedPrefixes = prefixes.slice().sort((a, b) => b.length - a.length);

	for (const p of sortedPrefixes) {
		if (body.startsWith(p)) {
			prefix = p;
			isCommand = true;
			break;
		}
	}

	if (!isCommand && isOwner && sortedPrefixes.length && allCmd.length) {
		const parts = body.trim().split(/\s+/);
		const possibleCmd = (parts[0] || "").toLowerCase();
		if (allCmd.includes(possibleCmd)) {
			command = possibleCmd;
			args = parts.slice(1);
			text = args.join(" ");
			isCommand = true;
		}
	} else if (isCommand) {
		const contentWithoutPrefix = body.slice(prefix.length).trim();
		const parts = contentWithoutPrefix.split(/\s+/);
		command = (parts.shift() || "").toLowerCase();
		args = parts;
		text = args.join(" ");
	}

	return { prefix, isCommand, command, args, text };
}
