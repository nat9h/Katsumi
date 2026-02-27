import { exec, spawn } from "child_process";
import { fileTypeFromBuffer } from "file-type";
import ffmpeg from "fluent-ffmpeg";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import crypto from "node:crypto";
import { tmpdir } from "node:os";
import { PassThrough, Readable } from "node:stream";
import { join } from "path";

const supported_audio_args = {
	"3g2": [
		"-vn",
		"-c:a",
		"libopus",
		"-b:a",
		"128k",
		"-vbr",
		"on",
		"-compression_level",
		"10",
	],
	"3gp": [
		"-vn",
		"-c:a",
		"libopus",
		"-b:a",
		"128k",
		"-vbr",
		"on",
		"-compression_level",
		"10",
	],
	aiff: ["-vn", "-c:a", "pcm_s16be"],
	amr: ["-vn", "-c:a", "libopencore_amrnb", "-ar", "8000", "-b:a", "12.2k"],
	flac: ["-vn", "-c:a", "flac"],
	m4a: ["-vn", "-c:a", "aac", "-b:a", "128k"],
	m4r: ["-vn", "-c:a", "libfdk_aac", "-b:a", "64k"],
	mka: ["-vn", "-c:a", "libvorbis", "-b:a", "128k"],
	mp3: ["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
	ogg: ["-vn", "-c:a", "libvorbis", "-q:a", "3"],
	opus: [
		"-vn",
		"-c:a",
		"libopus",
		"-b:a",
		"128k",
		"-vbr",
		"on",
		"-compression_level",
		"10",
	],
	wav: ["-vn", "-c:a", "pcm_s16le"],
	wma: ["-vn", "-c:a", "wmav2", "-b:a", "128k"],
};
/**
 * Converts the media buffer to a stream.
 * @param {Buffer} buffer - The media buffer to convert.
 * @returns {Readable} - The converted media stream.
 * @private
 */
export function bufferToStream(buffer) {
	const stream = new Readable();
	stream.push(buffer);
	stream.push(null);
	return stream;
}

/**
 * Converts the media buffer to a webp format using ffmpeg.
 * @param {Buffer} mediaBuffer - The media buffer to convert.
 * @param {string[]} args - The additional arguments for ffmpeg.
 * @param {string} format - The format to convert to (default: "webp").
 * @returns {Promise<Buffer>} - The converted media buffer.
 */
export async function convert(mediaBuffer, args, format = null) {
	const tempPath = join(tmpdir(), crypto.randomBytes(16).toString("hex"));
	return new Promise((resolve, reject) => {
		const ffmpegProcess = ffmpeg()
			.input(bufferToStream(mediaBuffer))
			.addOutputOptions(args)
			.format(format)
			.on("end", () => {
				if (existsSync(tempPath)) {
					const buffer = readFileSync(tempPath);
					unlinkSync(tempPath);
					resolve(buffer);
				}
			})
			.on("error", (err) => {
				reject(err);
			});
		ffmpegProcess.save(tempPath);
	});
}

/**
 *
 * @param {Buffer} mediaBuffer - The audio buffer to convert.
 * @param {string} ext - The file extension of the audio.
 * @returns {Promise<Buffer>} - The converted audio buffer.
 * @throws {Error} - If the file type is not supported.
 */
export async function to_audio(mediaBuffer, ext = null) {
	if (!ext) {
		ext = (await fileTypeFromBuffer(mediaBuffer)).ext;
	}
	if (!supported_audio_args[ext]) {
		throw new Error(`Unsupported file type ${ext}`);
	}
	const args = supported_audio_args[ext];
	const audio = await convert(mediaBuffer, args, ext);
	return audio;
}

/**
 * Converts a WebP buffer to an MP4 video.
 * @param {Buffer} buffer - The input buffer containing WebP data.
 * @returns {Promise<Buffer>} A promise that resolves with the MP4 video buffer.
 * @throws Will throw an error if the input buffer is not valid or conversion fails.
 */
export async function webpToVideo(buffer) {
	if (!Buffer.isBuffer(buffer)) {
		throw new Error("The buffer must be not empty");
	}

	const { ext } = await fileTypeFromBuffer(buffer);
	if (!/(webp)/i.test(ext)) {
		throw new Error("Buffer not supported media");
	}

	const input = join(".", `${Date.now()}.${ext}`);
	const gif = join(".", `${Date.now()}.gif`);
	const output = join(".", `${Date.now()}.mp4`);

	writeFileSync(input, buffer);

	return new Promise((resolve, reject) => {
		exec(`convert ${input} ${gif}`, (err) => {
			if (err) {
				unlinkSync(input);
				return reject(err);
			}

			exec(
				`ffmpeg -i ${gif} -pix_fmt yuv420p -c:v libx264 -movflags +faststart -filter:v crop='floor(in_w/2)*2:floor(in_h/2)*2' ${output}`,
				(err) => {
					if (err) {
						unlinkSync(input);
						unlinkSync(gif);
						return reject(err);
					}

					let buff = readFileSync(output);
					resolve(buff);

					unlinkSync(input);
					unlinkSync(gif);
					unlinkSync(output);
				}
			);
		});
	});
}

/**
 * Converts a WebP buffer to a PNG image.
 * @param {Buffer} buffer - The input buffer containing WebP data.
 * @returns {Promise<Buffer>} A promise that resolves with the PNG image buffer.
 * @throws Will throw an error if the conversion process fails.
 */
export async function webpToImage(buffer) {
	return new Promise((resolve, reject) => {
		try {
			const chunks = [];
			const command = spawn("convert", ["webp:-", "png:-"]);

			command
				.on("error", (e) => reject(e))
				.stdout.on("data", (chunk) => chunks.push(chunk));

			command.stdin.write(buffer);
			command.stdin.end();

			command.on("exit", () => resolve(Buffer.concat(chunks)));
		} catch (err) {
			reject(err);
		}
	});
}

// audio effects
const audio_effects = {
	bass: { out: "bass", filter: "bass=g=20:f=110:w=0.6" },
	blown: {
		out: "blown",
		filter: "acrusher=level_in=4:level_out=5:bits=8:mode=log:aa=1",
	},
	deep: {
		out: "deep",
		filter: "asetrate=44100*0.7,aresample=44100,atempo=1.3",
	},
	earrape: {
		out: "earrape",
		filter: "volume=10,bass=g=30:f=80:w=0.6,acrusher=level_in=8:level_out=12:bits=4:mode=log:aa=1",
	},
	echo: { out: "echo", filter: "aecho=0.8:0.88:60:0.4" },
	fast: { out: "fast", filter: "atempo=1.5" },
	fat: {
		out: "fat",
		filter: "bass=g=15:f=60:w=0.8,lowpass=f=3000,volume=1.5",
	},
	nightcore: {
		out: "nightcore",
		filter: "asetrate=44100*1.25,aresample=44100,atempo=1.1",
	},
	reverse: { out: "reverse", filter: "areverse" },
	robot: {
		out: "robot",
		filter: "afftfilt=real='hypot(re,im)':imag='0',aecho=0.8:0.9:40:0.3,aresample=44100",
	},
	slowed: {
		out: "slow",
		filter: "asetrate=44100*0.9,aresample=44100,atempo=0.85",
	},
	smooth: {
		out: "smooth",
		filter: "lowpass=f=4500,bass=g=2:f=120,treble=g=-1:f=3000,volume=1.2",
	},
	chimpunk: {
		out: "squirrel",
		filter: "asetrate=44100*1.5,aresample=44100,atempo=1.1",
	},
};

export function getAudioEffectCommands() {
	return Object.keys(audio_effects);
}

export async function audioEffects(inputBuffer, effectName) {
	const key = (effectName || "").toLowerCase();
	const effect = audio_effects[key];
	if (!effect) {
		const available = Object.keys(audio_effects).join(", ");
		throw new Error(
			`Unknown effect: ${effectName}\nAvailable: ${available}`
		);
	}

	return new Promise((resolve, reject) => {
		const outStream = new PassThrough();
		const chunks = [];

		outStream.on("data", (c) => chunks.push(c));
		outStream.on("end", () => resolve(Buffer.concat(chunks)));
		outStream.on("error", reject);

		ffmpeg()
			.input(bufferToStream(inputBuffer))
			.noVideo()
			.outputOptions([
				"-map_metadata",
				"-1",
				"-af",
				effect.filter,
				"-b:a",
				"192k",
			])
			.format("mp3")
			.on("error", reject)
			.pipe(outStream, { end: true });
	});
}
