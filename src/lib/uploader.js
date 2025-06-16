import axios from "axios";
import { fileTypeFromBuffer } from "file-type";

/**
 * @abstract
 * @class Provider
 * @classdesc Abstract class for providers
 * @property {Function} form - Create a new FormData instance
 * @property {Function} upload - Upload a buffer to a provider
 * @throws {Error} Abstract class cannot be instantiated
 */
class Provider {
	/**
	 * @constructor
	 * @throws {Error} Abstract class cannot be instantiated
	 */
	constructor() {
		if (this.constructor === Provider) {
			throw new Error("Abstract class cannot be instantiated");
		}
	}

	/**
	 * Create a new FormData instance
	 * @param {any[]} args - Arguments to pass to FormData.append
	 * @returns {FormData} A new FormData instance
	 */
	form(...args) {
		const form = new FormData();
		if (args) {
			form.append(...args);
		}
		return form;
	}
}

/**
 * @class QuaxProvider
 * @classdesc Upload a buffer to qu.ax
 * @extends Provider
 */
class QuaxProvider extends Provider {
	/**
	 * Upload a buffer to qu.ax
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = this.form("files[]", blob, `file.${ext}`);
		const { data } = await axios.post("https://qu.ax/upload.php", form, {
			headers: {
				"Content-Type": "multipart/form-data",
			},
		});
		return data.files[0].url;
	}
}

/**
 * @class FreeImageProvider
 * @classdesc Upload a buffer to freeimage.host
 * @extends Provider
 */
class FreeImageProvider extends Provider {
	/**
	 * Upload a buffer to freeimage.host
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { data: html } = await axios
			.get("https://freeimage.host/")
			.catch(() => null);
		const token = html.match(/PF.obj.config.auth_token = "(.+?)";/)[1];
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = this.form("source", blob, `file.${ext}`);
		const options = {
			type: "file",
			action: "upload",
			timestamp: (Date.now() / 1000).toString(),
			auth_token: token,
			nsfw: "0",
		};
		for (const [key, value] of Object.entries(options)) {
			form.append(key, value);
		}
		const { data } = await axios.post("https://freeimage.host/json", form, {
			headers: {
				"Content-Type": "multipart/form-data",
			},
		});
		return data.image.url;
	}
}

/**
 * @class TmpFilesProvider
 * @classdesc Upload a buffer to tmpfiles.org
 * @extends Provider
 */
class TmpFilesProvider extends Provider {
	/**
	 * Upload a buffer to tmpfiles.org
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = this.form("file", blob, `file.${ext}`);
		const { data } = await axios.post(
			"https://tmpfiles.org/api/v1/upload",
			form,
			{
				headers: {
					"Content-Type": "multipart/form-data",
				},
			}
		);
		const url = data.data.url.match(/https:\/\/tmpfiles.org\/(.*)/)[1];
		return "https://tmpfiles.org/dl/" + url;
	}
}

/**
 * @class NetorareProvider
 * @classdesc Upload a buffer to storage.netorare.codes
 * @extends Provider
 */
class NetorareProvider extends Provider {
	/**
	 * Upload a buffer to storage.netorare.codes
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = this.form("file", blob, `file.${ext}`);
		const { data } = await axios.post("https://scdn.pdi.moe/upload", form, {
			headers: {
				"Content-Type": "multipart/form-data",
			},
		});
		return "https://scdn.pdi.moe" + data.result.downloadUrl;
	}
}

/**
 * @class Pomf2Provider
 * @classdesc Upload a buffer to pomf2.lain.la
 * @extends Provider
 */
class Pomf2Provider extends Provider {
	/**
	 * Upload a buffer to pomf2.lain.la
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = this.form("files[]", blob, `file.${ext}`);
		const { data } = await axios.post(
			"https://pomf2.lain.la/upload.php",
			form,
			{
				headers: {
					"Content-Type": "multipart/form-data",
				},
			}
		);
		return data.files[0].url;
	}
}

/**
 * @class Uguu
 * @classdesc Upload a buffer to uguu.se
 * @extends Provider
 */
class UguuProvider extends Provider {
	/**
	 * Upload a buffer to uguu.se
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = this.form("files[]", blob, `file.${ext}`);
		const { data } = await axios.post("https://uguu.se/upload.php", form, {
			headers: {
				"Content-Type": "multipart/form-data",
			},
		});
		return data.files[0].url;
	}
}

/**
 * @class CatboxProvider
 * @classdesc Upload a buffer to catbox.moe
 * @extends Provider
 */
class CatboxProvider extends Provider {
	/**
	 * Upload a buffer to catbox.moe
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = new FormData();
		form.append("reqtype", "fileupload");
		form.append("userhash", "b4429b5b2683032c0a0617ccd");
		form.append("fileToUpload", blob, `upload.${ext}`);

		const { data } = await axios.post(
			"https://catbox.moe/user/api.php",
			form,
			{
				headers: {
					...(form.getHeaders ? form.getHeaders() : {}),
					"Content-Type": "multipart/form-data",
				},
			}
		);

		return data;
	}
}

/**
 * @class imgbb
 * @classdesc Upload a buffer to imgbb.com
 * @extends Provider
 */
class ImgBBProvider extends Provider {
	/**
	 * Upload a buffer to imgbb.com
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = new FormData();
		form.append("image", blob, `file_${Date.now()}.${ext}`);
		const { data } = await axios.post(
			`https://api.imgbb.com/1/upload?expiration=604800&key=${process.env.IBB_KEY}`,
			form,
			{
				headers: {
					"Content-Type": "multipart/form-data",
				},
			}
		);
		return data.data.url;
	}
}

/**
 * @class PasteboardProvider
 * @classdesc Upload a buffer to pai.sh
 * @extends Provider
 */
class PasteboardProvider extends Provider {
	/**
	 * Upload a buffer to PasteboardProvider
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = this.form("file", blob, `image.${ext}`);
		form.set("cb", "-9");
		const { data } = await axios.post(
			"https://pasteboard.co/upload",
			form,
			{
				headers: {
					"Content-Type": "multipart/form-data",
				},
			}
		);
		if (!data.url) {
			throw new Error(data);
		}
		return "https://pasteboard.co/" + data.fileName;
	}
}

/**
 * @class Pixhost
 * @classdesc Upload a buffer to pixhost.to
 * @extends Provider
 */
class Pixhost extends Provider {
	/**
	 * Upload a buffer to Pixhost
	 * @param {Buffer} buffer - The buffer to upload
	 * @returns {Promise<string>} The URL of the uploaded file
	 */
	async upload(buffer) {
		const { mime, ext } = await fileTypeFromBuffer(buffer);
		const blob = new Blob([buffer], { type: mime });
		const form = this.form("img", blob, `image.${ext}`);
		form.set("content_type", "0");
		const { data } = await axios.post(
			"https://api.pixhost.to/images",
			form,
			{
				headers: {
					"Content-Type": "multipart/form-data; charset=utf-8",
					Accept: "application/json",
				},
			}
		);
		const { data: html } = await axios.get(data.show_url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
			},
		});

		const regex = html.match(
			/id="image"[^>]*class="image-img"[^>]*src="([^"]*)"/
		);
		if (!regex || !regex[1]) {
			throw new Error("Failed.");
		}

		return regex[1];
	}
}

/**
 * @class Uploader
 * @classdesc Upload a buffer to a provider
 * @property {Object} providers - The available providers
 * @method isBuffer - Check if a buffer is a buffer
 * @method upload - Upload a buffer to a provider
 */
class Uploader {
	/**
	 * @constructor
	 */
	constructor() {
		this.providers = {
			quax: new QuaxProvider(),
			freeimage: new FreeImageProvider(),
			tmpfiles: new TmpFilesProvider(),
			netorare: new NetorareProvider(),
			pomf2: new Pomf2Provider(),
			uguu: new UguuProvider(),
			catbox: new CatboxProvider(),
			imgBB: new ImgBBProvider(),
			pasteBoard: new PasteboardProvider(),
			pixHost: new Pixhost(),
		};
	}

	/**
	 * Check if a buffer is a buffer
	 * @param {Buffer} buffer - The buffer to check
	 * @returns {boolean} Whether the buffer is a buffer
	 */
	isBuffer(buffer) {
		return Buffer.isBuffer(buffer);
	}

	/**
	 * Upload a buffer to a provider
	 * @param {Buffer} buffer - The buffer to upload
	 * @param {string} provider - The provider to upload to
	 * @returns {Promise<string>} The URL of the uploaded file
	 * @throws {Error} Uploader not found
	 * @throws {Error} Buffer is not a buffer
	 * @throws {Error} Error uploading file
	 */
	async upload(buffer, provider) {
		if (!this.providers[provider]) {
			throw new Error("Uploader not found");
		}
		if (!Buffer.isBuffer(buffer)) {
			throw new Error("Buffer is not a buffer");
		}
		try {
			const url = await this.providers[provider].upload(buffer);
			return url;
		} catch (error) {
			throw new Error(error);
		}
	}
}

const uploader = new Uploader();

export default uploader;

export const {
	quax,
	freeimage,
	tmpfiles,
	netorare,
	pomf2,
	uguu,
	catbox,
	imgBB,
	pasteBoard,
	pixHost,
} = uploader.providers;
