import Connect from "#core/connect";
import { autoLoadCloneBots } from "#lib/clonebot/load";
import { Colors, colorize } from "#lib/colors";
import print from "#lib/print";

function centerText(text, width = 55) {
	const pad = Math.max(0, Math.floor((width - text.length) / 2));
	return " ".repeat(pad) + text;
}

function art() {
	return [
		colorize(Colors.FgWhite, centerText("Katsumi by NatsumiWorld")),
		colorize(
			Colors.FgWhite,
			"+====================================================+"
		),
		colorize(
			Colors.FgWhite,
			"|         ,-~~\\             ,-. <~)_   ,-==.     ;. .|"
		),
		colorize(
			Colors.FgWhite,
			"|          (   \\            | |  ( v~\\  (  (\\   ; |  |"
		),
		colorize(
			Colors.FgWhite,
			"|.-===-.,   |\\. \\   .-==-.  | '   \\_/'   |\\.\\\\  `.|  |"
		),
		colorize(
			Colors.FgWhite,
			"|\\.___.'   _]_]\\ \\ /______\\ |     /\\    _]_]\\ \\   |  |"
		),
		colorize(
			Colors.FgWhite,
			"+====================================================+"
		),
	].join("\n");
}

async function animateStartup() {
	const msg = "🚀 Starting Katsumi WhatsApp Bot";
	for (let i = 0; i < 3; i++) {
		process.stdout.write(
			`\r${colorize(Colors.FgYellow, msg + ".".repeat(i + 1) + "   ")}`
		);
		await new Promise((res) => setTimeout(res, 400));
	}
	process.stdout.write("\r" + " ".repeat(msg.length + 3) + "\r");
}

const bot = new Connect();

try {
	console.log(art());
	await animateStartup();
	print.info("Bot started & periodic task scheduled!");

	await bot.start();
	await autoLoadCloneBots();

	process.on("SIGINT", async () => {
		print.debug(colorize(Colors.FgYellow, "🛑 Stopping bot..."));
		bot.pluginManager.stopAllPeriodicTasks();
		print.debug(colorize(Colors.FgGreen, "✅ Bot stopped successfully"));
		process.exit(0);
	});
} catch (error) {
	print.error(colorize(Colors.FgRed, "Failed to start WhatsApp Bot:"), error);
	process.exit(1);
}
