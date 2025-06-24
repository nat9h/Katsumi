import cp, { exec as _exec } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { promisify } from "util";
import { BOT_CONFIG } from "../../config/index.js";
import print from "../../lib/print.js";

const exec = promisify(_exec).bind(cp);

export default {
	name: "autobackup",
	command: [],
	execute: () => {},
	ephemeralExpiration: 86400, // set ephemeral
	hidden: true,
	owner: true,
	periodic: {
		enabled: false, // true to enable automatic backup
		type: "interval", // Required: so it's only called by interval scheduler, not message handler. Options: "interval" or "message"
		interval: 1000 * 60 * 60 * 24, // ms, adjust for production use (e.g. 3_600_000 for hourly)
		run: async function (_, { sock }) {
			// First param (m) is ignored for interval type
			// support param 'm' if u using type message, like this -> run: async function (m, { sock }) {...}
			const ownerJids = BOT_CONFIG.ownerJids.map(
				(j) => `${j}@s.whatsapp.net`
			);
			const zipPath = "./tmp/script.zip";
			try {
				const now = new Date();
				const dateString = now.toLocaleString("en-US", {
					day: "2-digit",
					month: "long",
					year: "numeric",
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
					hour12: true,
				});
				print.debug(
					`⏳ [Auto-Backup] Starting backup process at ${now.toLocaleTimeString()}...`
				);

				if (!existsSync("./tmp")) {
					mkdirSync("./tmp");
				}

				const compressCmd =
					process.platform === "win32"
						? `7z a -tzip ${zipPath} * -xr!node_modules -xr!tmp -xr!.git -xr!*.log`
						: `zip -r ${zipPath} . -x "node_modules/*" "tmp/*" ".git/*" "*.log"`;

				await exec(compressCmd);

				if (ownerJids.length > 0) {
					await sock.sendMessage(
						ownerJids[0],
						{
							document: readFileSync(zipPath),
							mimetype: "application/zip",
							fileName: `backup_script_${Date.now()}.zip`,
							caption: `🗓️ Automated Script Backup\nDate: ${dateString}`,
						},
						{ ephemeralExpiration: this.ephemeralExpiration }
					);
					print.debug(
						"✅ [Auto-Backup] Backup successfully sent to owner."
					);
				} else {
					print.warn(
						"⚠️ [Auto-Backup] No owner JIDs configured. Cannot send backup."
					);
				}
				unlinkSync(zipPath);
				print.debug("🗑️ [Auto-Backup] Temporary backup file deleted.");
			} catch (err) {
				print.error("❌ [Auto-Backup] Backup failed:", err);
				if (ownerJids.length > 0) {
					await sock
						.sendMessage(ownerJids[0], {
							text: `❌ Auto-backup failed: ${err.message || err}`,
						})
						.catch((e) =>
							print.error(
								"Failed to send error report to owner:",
								e
							)
						);
				}
			}
		},
	},
};
