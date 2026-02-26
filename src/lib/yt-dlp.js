import { delay } from "#lib/functions";
import { to_audio } from "#utils/converter";
import axios from "axios";
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
 * Downloads YouTube video or audio content using ytdown.to service
 * @async
 * @param {string} url - The YouTube video URL to download
 * @param {('video'|'audio')} [type='video'] - The media type to download (video or audio)
 * @returns {Promise<Object>} A promise that resolves to an object containing media information and download URL
 * @throws {Error} If the API returns an error, media type is not found, or metadata is not found
 *
 * @typedef {Object} MediaInfo
 * @property {Object} info - Media information
 * @property {string} info.title - Title of the video
 * @property {string} info.desc - Description of the video
 * @property {string} info.thumbnail - URL of the video thumbnail
 * @property {string} info.views - Number of views
 * @property {string} info.uploader - Name of the uploader
 * @property {string} info.quality - Quality of the media
 * @property {string} info.duration - Duration of the media
 * @property {string} info.extension - File extension
 * @property {string} info.size - File size
 * @property {string} download - Direct download URL for the media
 */
export async function ytdown(url, type = "video") {
	const { data } = await axios.post(
		"https://app.ytdown.to/proxy.php",
		new URLSearchParams({ url }),
		{ headers: { "Content-Type": "application/x-www-form-urlencoded" } }
	);

	const api = data.api;
	if (api?.status == "ERROR") {
		throw new Error(api.message);
	}

	const media = api?.mediaItems?.find(
		(m) => m.type.toLowerCase() === type.toLowerCase()
	);
	if (!media) {
		throw new Error("Media type not found");
	}

	while (true) {
		const { data: res } = await axios.get(media.mediaUrl);

		if (res?.error === "METADATA_NOT_FOUND") {
			throw new Error("Metadata not found");
		}

		if (
			res?.percent === "Completed" &&
			res?.fileUrl !== "In Processing..."
		) {
			return {
				info: {
					title: api.title,
					desc: api.description,
					thumbnail: api.imagePreviewUrl,
					views: api.mediaStats?.viewsCount,
					uploader: api.userInfo?.name,
					quality: media.mediaQuality,
					duration: media.mediaDuration,
					extension: media.mediaExtension,
					size: media.mediaFileSize,
				},
				download: res.fileUrl,
			};
		}

		await delay(5000);
	}
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
	const { video = false, title = "youtube" } = opts;

	const result = await ytdown(url, video ? "video" : "audio");

	if (!result?.download) {
		throw new Error("Download link not found");
	}

	const { data } = await axios.get(result.download, {
		responseType: "arraybuffer",
	});

	let buffer = Buffer.from(data);

	if (!video) {
		buffer = await to_audio(buffer, "mp3");
	}

	const safeTitle = (title || result.info.title || "yt")
		.replace(/[\\/:*?"<>|]/g, "")
		.slice(0, 60);

	return {
		buffer,
		mimetype: video ? "video/mp4" : "audio/mpeg",
		fileName: `${safeTitle}.${video ? "mp4" : "mp3"}`,
	};
}
