import { exec } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import util from "util";

const execPromise = util.promisify(exec);

/**
 * Download YouTube audio/video with yt-dlp.
 * @param {String} url
 * @param {Object} opts { video?:boolean, cookiesPath?:string }
 * @returns {Promise<{buffer: Buffer, fileName: string}>}
 */
export async function downloadYt(url, opts = {}) {
	const { video = false, title = "youtube" } = opts;
	const cookiesPath = join(process.cwd(), "cookies.txt");

	const format = video ? "best[ext=mp4][height<=360]" : "bestaudio[ext=m4a]";
	const outputExt = video ? "mp4" : "m4a";

	const outFile = `/tmp/yt_${Date.now()}.${outputExt}`;
	const args = ["-f", format, "-o", outFile, url];

	try {
		readFileSync(cookiesPath);
		args.unshift("--cookies", cookiesPath);
	} catch {
		console.warn("cookies.txt not found. Proceeding without cookies.");
	}

	const cmd = `yt-dlp ${args.map((a) => `"${a}"`).join(" ")}`;
	await execPromise(cmd, { maxBuffer: 300 * 1024 * 1024 });

	const buffer = readFileSync(outFile);
	unlinkSync(outFile);

	return {
		buffer,
		fileName: `${title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "yt"}.${outputExt}`,
	};
}
