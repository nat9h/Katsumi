import { execSync } from "child_process";
import fs from "fs";
import crypto from "node:crypto";
import path from "path";

export default {
	name: "squirrel",
	description: "Convert audio/video into chipmunk (squirrel) voice.",
	command: ["squirrel", "chipmunk", "alvin", "tupai"],
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
		const outputPath = path.join(tempDir, `squirrel_${id}.mp3`);

		try {
			const media = await q.download();
			const buffer = Buffer.isBuffer(media) ? media : Buffer.from(media);

			fs.writeFileSync(inputPath, buffer);

			// Chipmunk effect (pitch up)
			execSync(
				`ffmpeg -y -i "${inputPath}" -map_metadata -1 -vn -af "asetrate=44100*1.5,aresample=44100,atempo=1.1" -b:a 192k "${outputPath}"`,
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
