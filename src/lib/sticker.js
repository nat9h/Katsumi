import { outputOptionsArgs } from "#config/sticker";
import { convert } from "#utils/converter";
import { fileTypeFromBuffer } from "file-type";
import ffmpeg from "fluent-ffmpeg";
import webp from "node-webpmux";

/**
 * Generates the metadata for the sticker.
 * @param {Object} options - The options for the sticker metadata.
 * @returns {Buffer} - The metadata buffer.
 */
function metadata(options) {
	const loadDataExif = Buffer.concat([
		Buffer.from([
			0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41,
			0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
		]),
		Buffer.from(JSON.stringify(options), "utf-8"),
	]);
	loadDataExif.writeUIntLE(
		Buffer.from(JSON.stringify(options), "utf-8").length,
		14,
		4
	);
	return loadDataExif;
}

/**
 * Generates the exif data for the sticker.
 * @param {string} packname - The pack name for the sticker.
 * @param {string} author - The author of the sticker.
 * @param {string[]} emojis - The emojis associated with the sticker.
 * @returns {Object} - The exif data object.
 */
function exif(packname, author, emojis) {
	return {
		"sticker-pack-id":
			"com.snowcorp.stickerly.android.stickercontentprovider b5e7275f-f1de-4137-961f-57becfad34f2",
		"sticker-pack-name": packname,
		"sticker-pack-publisher": author,
		emojis: Array.isArray(emojis) ? emojis : [emojis],
		"is-avatar-sticker": 0,
		"is-ai-sticker": 0,
		"api-url": "https://natsyn.xyz",
		"android-app-store-link":
			"https://play.google.com/store/apps/details?id=com.snowcorp.stickerly.android",
		"ios-app-store-link":
			"https://apps.apple.com/us/app/sticker-ly-sticker-maker/id1458740001",
	};
}

/**
 * Represents a Sticker object.
 * @class
 */
class Sticker {
	/**
	 * Constructs a new Sticker object.
	 * @constructor
	 */
	constructor() {
		this.ffmpeg = ffmpeg;
		this.packname = "@natsumiworld";
		this.author = "Natsyn";
	}

	/**
	 * Creates a sticker from the media buffer.
	 * @param {Buffer} mediaBuffer - The media buffer to create the sticker from.
	 * @param {Object} options - The options for creating the sticker.
	 * @param {string} options.packname - The pack name for the sticker.
	 * @param {string} options.author - The author of the sticker.
	 * @param {string[]} options.emojis - The emojis associated with the sticker.
	 * @returns {Promise<Buffer>} - The created sticker buffer.
	 */
	async create(
		mediaBuffer,
		{ packname = this.packname, author = this.author, emojis = ["❤️"] }
	) {
		const { mime } = (await fileTypeFromBuffer(mediaBuffer)) || {};
		if (!mime) {
			throw new Error("Invalid file type");
		}

		const args = mime.includes("image")
			? outputOptionsArgs.image
			: outputOptionsArgs.video;
		const webpBuffer =
			(!mime.includes("webp") &&
				(await convert(mediaBuffer, args, "webp"))) ||
			mediaBuffer;
		const image = new webp.Image();
		await image.load(webpBuffer);
		const exifData = metadata(exif(packname, author, emojis));
		image.exif = exifData;
		return await image.save(null);
	}
}

export default new Sticker();
