import axios from "axios";
import crypto from "node:crypto";

export class FaceSwap {
	constructor() {
		this.RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCwlO+boC6cwRo3UfXVBadaYwcX
0zKS2fuVNY2qZ0dgwb1NJ+/Q9FeAosL4ONiosD71on3PVYqRUlL5045mvH2K9i8b
AFVMEip7E6RMK6tKAAif7xzZrXnP1GZ5Rijtqdgwh+YmzTo39cuBCsZqK9oEoeQ3
r/myG9S+9cR5huTuFQIDAQAB
-----END PUBLIC KEY-----`;
		this.SECRET = "1H5tRtzsBkqXcaJ";
		this.APP_ID_V1 = "aifaceswap_v1";
		this.BASE_URL = "https://aifaceswap.io";

		this.themeVersion = "";
		this.keyId = "";
		this.client = axios.create({
			baseURL: this.BASE_URL,
		});
	}

	_makeid(length) {
		let result = "";
		const characters =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		for (let i = 0; i < length; i++) {
			result += characters.charAt(
				Math.floor(Math.random() * characters.length)
			);
		}
		return result;
	}

	_md5Hash(data) {
		return crypto.createHash("md5").update(data).digest("hex");
	}

	_aesCbcEncrypt(text, keyStr, ivStr) {
		const key = Buffer.from(keyStr, "utf-8");
		const iv = Buffer.from(ivStr, "utf-8");
		const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
		let encrypted = cipher.update(text, "utf-8", "base64");
		encrypted += cipher.final("base64");
		return encrypted;
	}

	_aesGcmEncrypt(jsonStr, themeVersion) {
		const keyBuffer = crypto
			.createHash("sha256")
			.update(themeVersion)
			.digest();
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
		const encrypted1 = cipher.update(jsonStr, "utf-8");
		const encrypted2 = cipher.final();
		const authTag = cipher.getAuthTag();
		return Buffer.concat([iv, encrypted1, encrypted2, authTag]).toString(
			"base64"
		);
	}

	async initSession() {
		console.log("[INIT] GET Cookie & Theme Version...");
		const res = await this.client.get("/");
		const html = res.data;

		const themeMatch = html.match(/data-kt-theme-version="([^"]+)"/);
		if (themeMatch) {
			this.themeVersion = themeMatch[1];
		}

		const cookies = res.headers["set-cookie"];
		if (cookies) {
			const match = cookies.join(";").match(/key_id=([^;]+)/);
			if (match) {
				this.keyId = `key_id=${match[1]}`;
			}
		}
		console.log(
			`[INIT] Theme: ${this.themeVersion.substring(0, 10)}... | Cookie: ${this.keyId ? "Found" : "Not Found"}`
		);
	}

	_generateSignatureHeaders() {
		const now = new Date();
		const utcDate = new Date(
			Date.UTC(
				now.getUTCFullYear(),
				now.getUTCMonth(),
				now.getUTCDate(),
				now.getUTCHours(),
				now.getUTCMinutes(),
				now.getUTCSeconds()
			)
		);
		const timestamp = Math.floor(utcDate.getTime() / 1000);
		const nonce = crypto.randomUUID();
		const aesSecret = this._makeid(16);

		const encrypted = crypto.publicEncrypt(
			{
				key: this.RSA_PUBLIC_KEY,
				padding: crypto.constants.RSA_PKCS1_PADDING,
			},
			Buffer.from(aesSecret, "utf-8")
		);

		const secretKey = encrypted.toString("base64");
		const signString = `${this.APP_ID_V1}:${this.SECRET}:${timestamp}:${nonce}:${secretKey}`;
		const sign = this._aesCbcEncrypt(signString, aesSecret, aesSecret);

		return { timestamp, nonce, sign, secretKey, aesSecret };
	}

	async uploadImage(imageUrl) {
		console.log(`[UPLOAD] Downloading: ${imageUrl}`);
		const imgRes = await axios.get(imageUrl, {
			responseType: "arraybuffer",
		});
		const buffer = Buffer.from(imgRes.data, "binary");

		const fileHash = this._md5Hash(buffer);
		const ext =
			imageUrl.split(".").pop().split("?")[0].toLowerCase() || "jpg";
		const filename = `${fileHash}.${ext}`;

		const headers = {
			"Content-Type": "application/json",
			"x-code": Date.now().toString(),
			"theme-version": this.themeVersion,
			origin: this.BASE_URL,
			referer: `${this.BASE_URL}/`,
			cookie: this.keyId,
		};

		const uploadRes = await this.client.post(
			"/api/upload_file",
			{ file_name: filename, type: "image" },
			{ headers }
		);

		if (uploadRes.data.code !== 200) {
			throw new Error("Gagal request upload URL");
		}
		const ossUrl = uploadRes.data.data.url;

		await axios.put(ossUrl, buffer, {
			headers: {
				"Content-Type": `image/${ext}`,
				"x-oss-storage-class": "Standard",
			},
		});

		const cdnPath = ossUrl
			.split("?")[0]
			.replace(
				"https://yimeta-ai-face-swap.oss-us-west-1.aliyuncs.com/",
				""
			);
		return { cdnPath, baseName: fileHash };
	}

	async run(sourceUrl, faceUrl) {
		try {
			if (!this.themeVersion) {
				await this.initSession();
			}

			const sourceData = await this.uploadImage(sourceUrl);
			const faceData = await this.uploadImage(faceUrl);

			const sigData = this._generateSignatureHeaders();
			const fp = crypto.randomBytes(16).toString("hex");
			const fp1 = this._aesCbcEncrypt(
				`${this.APP_ID_V1}:${fp}`,
				sigData.aesSecret,
				sigData.aesSecret
			);
			const requestNonce = this._md5Hash(
				`${sourceData.baseName}:${faceData.baseName}`
			);

			const payloadData = {
				source_image: sourceData.cdnPath,
				face_image: faceData.cdnPath,
				type_1: 0,
			};

			console.log("[GENERATE] Encrypting payload...");
			const encryptedData = this._aesGcmEncrypt(
				JSON.stringify(payloadData),
				this.themeVersion
			);

			const headers = {
				"Content-Type": "application/json",
				"x-code": Date.now().toString(),
				"theme-version": this.themeVersion,
				origin: this.BASE_URL,
				referer: `${this.BASE_URL}/`,
				fp: fp,
				fp1: fp1,
				nonce: requestNonce,
				"x-guide": sigData.secretKey,
				"x-sign": sigData.sign,
				cookie: this.keyId,
			};

			const genRes = await this.client.post(
				"/api/generate_face",
				{ request_type: 2, data: encryptedData },
				{ headers }
			);

			if (genRes.data.code !== 200) {
				console.error("[ERROR] Generate API Error:", genRes.data);
				return;
			}

			if (genRes.data.data.result_image) {
				console.log(
					`[DONE] Result: https://art-global.faceai.art/${genRes.data.data.result_image}`
				);
				return;
			}

			const taskId = genRes.data.data.task_id;
			if (!taskId) {
				return console.error("[ERROR] Task ID tidak ditemukan.");
			}

			console.log(`[SUCCESS] Task ID: ${taskId}. Waiting...`);

			return await this._pollStatus(taskId, requestNonce);
		} catch (err) {
			console.error("Error:", err.message);
			if (err.response) {
				console.error(err.response.data);
			}
		}
	}

	async _pollStatus(taskId, nonce) {
		let status = 1;
		while (status === 1 || status === 0) {
			await new Promise((r) => setTimeout(r, 3000));

			const statusRes = await this.client.post(
				"/api/check_status",
				{ task_id: taskId, nonce: nonce },
				{
					headers: {
						"Content-Type": "application/json",
						"x-code": Date.now().toString(),
						"theme-version": this.themeVersion,
						cookie: this.keyId,
					},
				}
			);

			const data = statusRes.data.data;
			status = data.status;

			if (status === 2) {
				console.log(
					`[DONE] Result: https://art-global.faceai.art/${data.result_image}`
				);
				return `https://art-global.faceai.art/${data.result_image}`;
			}
			if (status === 3 || status === -1) {
				throw new Error("Task failed on server.");
			} else {
				console.log(`[STATUS] Queue: ${data.rank}/${data.queue_len}`);
			}
		}
	}
}

// Example usage
// const faceSwapper = new FaceSwap();
// faceSwapper.run(
// 	"https://files.catbox.moe/bl1e7m.jpg",
// 	"https://files.catbox.moe/trw1ul.png"
// );
