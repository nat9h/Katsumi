import { exec } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import util from "util";

const execPromise = util.promisify(exec);

function fakeCookie() {
	return [
		`PREF=f${Math.floor(Math.random() * 100000)}`,
		`YSC=${Math.random().toString(36).substring(2, 18)}`,
		`VISITOR_INFO1_LIVE=${Math.random().toString(36).substring(2, 13)}`,
	].join("; ");
}

/**
 * Download YouTube audio/video with yt-dlp.
 * @param {String} url
 * @param {Object} opts { video?:boolean }
 * @returns {Promise<{buffer: Buffer, fileName: string}>}
 */
export async function downloadYt(url, opts = {}) {
	const { video = false, title = "youtube" } = opts;

	const format = video ? "best[ext=mp4][height<=360]" : "bestaudio[ext=m4a]";
	const outputExt = video ? "mp4" : "m4a";
	const outFile = `/tmp/yt_${Date.now()}.${outputExt}`;
	const args = ["-f", format, "-o", outFile];

	if (/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//.test(url)) {
		args.push(
			"--add-header",
			"Accept-Language:en-US,en;q=0.9",
			"--add-header",
			"Referer:https://www.youtube.com/",
			"--add-header",
			`Cookie:${fakeCookie()}`,
			"--extractor-args",
			"youtube:client=android"
		);
	}

	args.push(url);

	const cmd = `yt-dlp ${args.map((a) => `"${a}"`).join(" ")}`;
	await execPromise(cmd, { maxBuffer: 300 * 1024 * 1024 });

	const buffer = readFileSync(outFile);
	unlinkSync(outFile);

	return {
		buffer,
		fileName: `${title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "yt"}.${outputExt}`,
	};
}
