import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export default {
	name: "lowq",
	description: "Destroy media quality beyond recognition.",
	command: ["lowq", "destroy"],
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "tools",
	cooldown: 5,
	limit: false,
	usage: "$prefix$command (reply image/video)",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m) => {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q.type || "";

		if (!/image|video/i.test(mime)) {
			return m.reply("Reply image or video with the command.");
		}

		const media = await q.download();
		if (!media) {
			return m.reply("Failed to download media.");
		}

		const tmpDir = os.tmpdir();
		const unique = Date.now();
		const inputPath = path.join(tmpDir, `input_${unique}`);
		const isVideo = /video/i.test(mime);
		const outputPath = path.join(
			tmpDir,
			`output_${unique}${isVideo ? ".mp4" : ".jpg"}`
		);

		fs.writeFileSync(inputPath, media);

		await new Promise((resolve, reject) => {
			let args;

			if (isVideo) {
				args = [
					"-y",
					"-i",
					inputPath,
					"-vf",
					"scale=120:-2,scale=854:-2:flags=neighbor,fps=6,noise=alls=80:allf=t+u",
					"-filter_complex",
					"[0:a]aresample=8000,volume=3.0,aecho=0.8:0.9:500:0.5[aout]",
					"-map",
					"0:v",
					"-map",
					"[aout]",
					"-c:v",
					"libx264",
					"-preset",
					"ultrafast",
					"-crf",
					"51",
					"-b:v",
					"50k",
					"-c:a",
					"aac",
					"-b:a",
					"8k",
					"-ar",
					"8000",
					"-ac",
					"1",
					"-strict",
					"-2",
					"-movflags",
					"+faststart",
					outputPath,
				];
			} else {
				args = [
					"-y",
					"-i",
					inputPath,
					"-vf",
					"scale=60:-2,scale=640:-2:flags=neighbor,noise=alls=80:allf=t+u",
					"-q:v",
					"31",
					outputPath,
				];
			}

			const ffmpeg = spawn("ffmpeg", args);

			let errData = "";
			ffmpeg.stderr.on("data", (d) => {
				errData += d.toString();
			});

			ffmpeg.on("error", reject);

			ffmpeg.on("close", (code) => {
				if (code !== 0) {
					console.error(errData);
					reject(new Error(`FFmpeg failed:\n${errData}`));
				} else {
					resolve();
				}
			});
		});

		const buffer = fs.readFileSync(outputPath);

		if (isVideo) {
			await m.reply({ video: buffer });
		} else {
			await m.reply({ image: buffer });
		}

		try {
			fs.unlinkSync(inputPath);
			fs.unlinkSync(outputPath);
		} catch {
			console.error(`[Cleanup Warning] Failed delete temp file: ${err.message}`);
		}
	},
};