import { fetchBuffer } from "#lib/functions";
import { APIRequest as api } from "#utils/API/request";
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

	const args = [
		"--js-runtimes",
		"deno",
		"--remote-components",
		"ejs:npm",
		"-f",
		format,
		"-o",
		outFile,
		url,
	];

	try {
		readFileSync(cookiesPath);
		args.unshift("--cookies", cookiesPath);
	} catch {
		console.warn("cookies.txt not found. Proceeding without cookies.");
	}

	const cmd = `yt-dlp ${args.map((a) => `"${a}"`).join(" ")}`;
	console.log("[yt-dlp cmd]", cmd);

	await execPromise(cmd, { maxBuffer: 300 * 1024 * 1024 });

	const buffer = readFileSync(outFile);
	unlinkSync(outFile);

	return {
		buffer,
		fileName: `${title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "yt"}.${outputExt}`,
	};
}

/**
 * Download YouTube audio/video via API
 * @param {String} url
 * @param {Object} opts
 * @param {Boolean} opts.video
 * @param {String} opts.videoQuality
 * @param {String} opts.audioFormat
 * @returns {Promise<{ buffer: Buffer, mimetype: string, fileName: string }>}
 */
export async function downloadApiYt(url, opts = {}) {
	const {
		video = false,
		videoQuality = "360p",
		audioFormat = "mp3",
		title = "youtube",
	} = opts;

	const idl = await api.Gratis.post("/downloader/youtube", {
		url,
		video: videoQuality,
		audio: audioFormat,
	});

	const { status, result } = idl.data;

	console.log("[YT API DEBUG]", JSON.stringify({ status, result }, null, 2));

	if (!status || !result) {
		throw new Error("Failed to fetch media from API");
	}

	const media = video ? result.video : result.audio;
	if (!media || !media.url) {
		throw new Error("Media URL not found");
	}

	const fileRes = await fetchBuffer(media.url);
	const buffer = fileRes.data;

	const ext = video ? "mp4" : audioFormat;
	const mimetype = video ? "video/mp4" : "audio/mpeg";

	const safeTitle = title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "yt";

	return {
		buffer,
		mimetype,
		fileName: `${safeTitle}.${ext}`,
	};
}