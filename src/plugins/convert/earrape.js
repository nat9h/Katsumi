import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export default {
	name: "earrape",
	description: "Add extreme loud / earrape effect to audio/video.",
	command: ["earrape", "earape", "loud"],
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

		const inputPath = path.join(tempDir, `input_${Date.now()}`);
		const outputPath = path.join(tempDir, `earrape_${Date.now()}.mp3`);

		try {
			const media = await q.download();
			const buffer = Buffer.isBuffer(media) ? media : Buffer.from(media);

			fs.writeFileSync(inputPath, buffer);

			execSync(
				`ffmpeg -y -i "${inputPath}" -af "volume=10,bass=g=30:f=80:w=0.6,acrusher=level_in=8:level_out=12:bits=4:mode=log:aa=1" -vn "${outputPath}"`,
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
