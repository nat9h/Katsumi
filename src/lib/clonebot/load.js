import { CloneSessionModel } from "#lib/database/models/cloneSessions";
import print from "#lib/print";
import CloneBot from "#lib/clonebot/connect";

export async function autoLoadCloneBots() {
	if (!process.env.MONGO_URI || process.env.USE_MONGO === "false") {
		print.warn("[CLONE] CloneBot is disabled (MongoDB not enabled)");
		return;
	}

	const sessions = await CloneSessionModel.list();
	let activeCount = 0;

	for (const session of sessions) {
		if (!session.connected) {
			continue;
		}

		const bot = new CloneBot(session.phone);

		bot.start(
			() => {},
			(result) => {
				if (result.connected) {
					print.info(
						`[CLONE] CloneBot session active for ${session.phone}`
					);
				}
			},
			(err) => {
				print.error(
					`[CLONE] Failed to load CloneBot session for ${session.phone}:`,
					err?.message || err
				);
			}
		);

		activeCount++;
	}

	print.info(`[CLONE] Total CloneBot sessions reloaded: ${activeCount}`);
}
