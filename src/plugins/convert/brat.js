import Sticker from "#lib/sticker";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export default {
	name: "brat",
	description: "Create a brat sticker.",
	command: ["brat"],
	usage: "$prefix$command <text>",
	permissions: "all",
	hidden: false,
	failed: "Failed to %command: %error",
	wait: null,
	category: "convert",
	cooldown: 5,
	limit: false,
	react: true,
	botAdmin: false,
	group: false,
	private: false,
	owner: false,

	execute: async (m) => {
		let input = m.text?.trim() || m.quoted?.text?.trim();

		if (!input) {
			return m.reply("Input text.");
		}

		const animated = /--animated/i.test(input);
		input = input.replace(/--animated/i, "").trim();

		if (!input) {
			return m.reply("Please provide the text.");
		}

		if (!animated) {
			const url = `https://shinana-brat.hf.space/?text=${encodeURIComponent(input)}`;
			const res = await fetch(url);
			if (!res.ok) {
				throw new Error("Failed to fetch brat image.");
			}
			const buffer = Buffer.from(await res.arrayBuffer());

			const sticker = await Sticker.create(buffer, {
				packname: "@natsumiworld.",
				author: m.pushName,
				emojis: "🤣",
			});

			return m.reply({ sticker });
		}

		const words = input.split(" ");
		const tempDir = path.join(process.cwd(), "temp");

		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true });
		}

		const time = Date.now();
		const framePaths = [];

		try {
			for (let i = 0; i < words.length; i++) {
				const currentText = words.slice(0, i + 1).join(" ");
				const url = `https://shinana-brat.hf.space/?text=${encodeURIComponent(currentText)}`;

				const res = await fetch(url);
				if (!res.ok) {
					throw new Error("Failed fetch frame");
				}

				const buffer = Buffer.from(await res.arrayBuffer());
				const framePath = path.join(tempDir, `${time}_${i}.png`);

				fs.writeFileSync(framePath, buffer);
				framePaths.push(framePath);
			}

			const listPath = path.join(tempDir, `${time}.txt`);
			let listContent = "";

			for (let i = 0; i < framePaths.length; i++) {
				listContent += `file '${framePaths[i]}'\n`;

				if (i === framePaths.length - 1) {
					listContent += "duration 1.9\n";
				} else {
					listContent += "duration 0.9\n";
				}
			}

			const lastFrame = framePaths[framePaths.length - 1];
			listContent += `file '${lastFrame}'\n`;
			listContent += `file '${lastFrame}'\n`;

			fs.writeFileSync(listPath, listContent);

			const outputWebp = path.join(tempDir, `${time}.webp`);

			execSync(
				`ffmpeg -y -f concat -safe 0 -i ${listPath} \
				-vf "fps=25,scale=512:512:force_original_aspect_ratio=decrease" \
				-loop 0 -an -vsync vfr -c:v libwebp ${outputWebp}`
			);

			const stickerBuffer = fs.readFileSync(outputWebp);

			const sticker = await Sticker.create(stickerBuffer, {
				packname: "@natsumiworld.",
				author: m.pushName,
				emojis: "😝",
			});

			await m.reply({ sticker });

			framePaths.forEach((f) => fs.unlinkSync(f));
			fs.unlinkSync(listPath);
			fs.unlinkSync(outputWebp);
		} catch (err) {
			console.log(err);
			m.reply("Failed to create animated brat.");
		}
	},
};
