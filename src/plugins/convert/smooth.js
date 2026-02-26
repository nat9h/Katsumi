import { execSync } from "child_process";
import fs from "fs";
import crypto from "node:crypto";
import path from "path";

export default {
	name: "smooth",
	description: "Convert audio/video into smooth mellow style.",
	command: ["smooth", "mellow", "soft"],
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "convert",
	cooldown: 10,
	limit: 1,
	usage: "$prefix$command reply audio/video",
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	/**
	 * @param {object} m - Serialized message
	 */
	execute: async (m) => {
		const q = m.isQuoted ? m.quoted : m;
		const mime = q.type || "";

		if (!/audio|video/i.test(mime)) {
			return m.reply(
				"Please reply/send audio or video with the command."
			);
		}

		const tempDir = path.join(process.cwd(), "temp");
		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true });
		}

		const id = crypto.randomBytes(4).toString("hex");
		const inputPath = path.join(tempDir, `input_${id}`);
		const outputPath = path.join(tempDir, `smooth_${id}.mp3`);

		try {
			const media = await q.download();
			const buffer = Buffer.isBuffer(media) ? media : Buffer.from(media);

			fs.writeFileSync(inputPath, buffer);

			execSync(
				`ffmpeg -y -i "${inputPath}" -map_metadata -1 -vn -af "lowpass=f=4500,bass=g=2:f=120,treble=g=-1:f=3000,volume=1.2" -b:a 192k "${outputPath}"`,
				{ stdio: "ignore" }
			);

			const audioBuffer = fs.readFileSync(outputPath);

			await m.reply({
				audio: audioBuffer,
				mimetype: "audio/mpeg",
			});
		} catch (error) {
			return m.reply(`Error: ${error.message}`);
		} finally {
			if (fs.existsSync(inputPath)) {
				fs.unlinkSync(inputPath);
			}
			if (fs.existsSync(outputPath)) {
				fs.unlinkSync(outputPath);
			}
		}
	},
};
