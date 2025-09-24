import { Colors, colorize } from "#lib/colors";

const log = (type, message, error = null) => {
	const timestamp = new Date().toLocaleString("id-ID");
	let color;
	switch (type.toUpperCase()) {
		case "INFO":
			color = Colors.Bright;
			break;
		case "WARN":
			color = Colors.FgRed;
			break;
		case "ERROR":
			color = Colors.BgRed;
			break;
		case "DEBUG":
			color = Colors.FgGray;
			break;
		default:
			color = Colors.FgGray;
			break;
	}
	let output = colorize(
		color,
		`[${timestamp}] [BOT ${type.toUpperCase()}] ${message}`
	);
	if (error instanceof Error) {
		output += `\n${colorize(Colors.FgRed, "Error: " + error.message)}`;
		if (error.stack) {
			output += `\n${colorize(Colors.FgGray, "Stack: " + error.stack)}`;
		}
	} else if (error) {
		output += `\nAdditional Info: ${JSON.stringify(error, null, 2)}`;
	}
	console.log(output);
};

/**
 * Print incoming message to the console.
 * @param {object} m - The serialized message object.
 * @param {import('baileys').WASocket} sock - The Baileys socket object.
 */
export const print = async (m, store) => {
	if (!m || m.messageTimestamp === undefined || m.messageTimestamp === null) {
		log("DEBUG", "Skipping print due to missing message timestamp.");
		return;
	}

	try {
		// const timestamp = new Date(m.messageTimestamp).toLocaleString("id-ID");
		let chatName = "Private Chat";

		if (m.isGroup) {
			if (m.metadata) {
				chatName = m.metadata.subject || `Group: ${m.from}`;
			} else if (store) {
				const metadata = store.getGroupMetadata(m.from);
				if (metadata) {
					chatName = metadata.subject || `Group: ${m.from}`;
				}
			}
		}

		console.log(colorize(Colors.FgWhite, "----- Incoming Message -----"));
		console.log(
			colorize(
				Colors.FgWhite,
				`[${chatName}] From: ${m.pushName} (${m.sender.split("@")[0]})`
			)
		);
		console.log(colorize(Colors.FgWhite, `[ID]: ${m.id}`));
		console.log(colorize(Colors.FgWhite, `[Type]: ${m.type}`));
		console.log(
			colorize(
				Colors.FgWhite,
				`[Body]: ${m.body ? m.body.substring(0, 100) + (m.body.length > 100 ? "..." : "") : "[Non-text message]"}`
			)
		);
		if (m.isCommand) {
			console.log(
				colorize(Colors.FgWhite, `[Command]: ${m.prefix}${m.command}`)
			);
		}
		console.log(colorize(Colors.FgWhite, "----------------------------"));
	} catch (error) {
		log("ERROR", "Failed to print message", error);
	}
};

export default {
	info: (message) => log("INFO", message),
	warn: (message) => log("WARN", message),
	error: (message, error) => log("ERROR", message, error),
	debug: (message) => log("DEBUG", message),
};
