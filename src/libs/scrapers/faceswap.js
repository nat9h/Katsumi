/**
 * @fileoverview Face swap scraper via aifaceswap.io (no API key needed).
 * @module scrapers/faceswap
 */

import crypto from "node:crypto";
import axios from "axios";

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
        this.client = axios.create({ baseURL: this.BASE_URL });
    }

    _makeid(length) {
        const chars =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let result = "";
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
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
        return cipher.update(text, "utf-8", "base64") + cipher.final("base64");
    }

    _aesGcmEncrypt(jsonStr, themeVersion) {
        const keyBuffer = crypto
            .createHash("sha256")
            .update(themeVersion)
            .digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
        const encrypted = Buffer.concat([
            cipher.update(jsonStr, "utf-8"),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();
        return Buffer.concat([iv, encrypted, authTag]).toString("base64");
    }

    async initSession() {
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
    }

    _generateSignatureHeaders() {
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = crypto.randomUUID();
        const aesSecret = this._makeid(16);

        const encrypted = crypto.publicEncrypt(
            {
                key: this.RSA_PUBLIC_KEY,
                padding: crypto.constants.RSA_PKCS1_PADDING,
            },
            Buffer.from(aesSecret, "utf-8"),
        );

        const secretKey = encrypted.toString("base64");
        const signString = `${this.APP_ID_V1}:${this.SECRET}:${timestamp}:${nonce}:${secretKey}`;
        const sign = this._aesCbcEncrypt(signString, aesSecret, aesSecret);

        return { timestamp, nonce, sign, secretKey, aesSecret };
    }

    async uploadImage(imageUrl) {
        const imgRes = await axios.get(imageUrl, {
            responseType: "arraybuffer",
        });
        const buffer = Buffer.from(imgRes.data);

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
            { headers },
        );

        if (uploadRes.data.code !== 200) {
            throw new Error("Failed to get upload URL.");
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
                "",
            );
        return { cdnPath, baseName: fileHash };
    }

    async _pollStatus(taskId, nonce) {
        const start = Date.now();
        while (Date.now() - start < 120_000) {
            await new Promise((r) => setTimeout(r, 3000));

            const res = await this.client.post(
                "/api/check_status",
                { task_id: taskId, nonce },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "x-code": Date.now().toString(),
                        "theme-version": this.themeVersion,
                        cookie: this.keyId,
                    },
                },
            );

            const data = res.data.data;
            if (data.status === 2) {
                return `https://art-global.faceai.art/${data.result_image}`;
            }
            if (data.status === 3 || data.status === -1) {
                throw new Error("Face swap task failed.");
            }
        }
        throw new Error("Face swap timed out.");
    }

    async run(sourceUrl, faceUrl) {
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
            sigData.aesSecret,
        );
        const requestNonce = this._md5Hash(
            `${sourceData.baseName}:${faceData.baseName}`,
        );

        const encryptedData = this._aesGcmEncrypt(
            JSON.stringify({
                source_image: sourceData.cdnPath,
                face_image: faceData.cdnPath,
                type_1: 0,
            }),
            this.themeVersion,
        );

        const headers = {
            "Content-Type": "application/json",
            "x-code": Date.now().toString(),
            "theme-version": this.themeVersion,
            origin: this.BASE_URL,
            referer: `${this.BASE_URL}/`,
            fp,
            fp1,
            nonce: requestNonce,
            "x-guide": sigData.secretKey,
            "x-sign": sigData.sign,
            cookie: this.keyId,
        };

        const genRes = await this.client.post(
            "/api/generate_face",
            { request_type: 2, data: encryptedData },
            { headers },
        );

        if (genRes.data.code !== 200) {
            throw new Error(
                genRes.data.message || "Face swap generation failed.",
            );
        }

        if (genRes.data.data.result_image) {
            return `https://art-global.faceai.art/${genRes.data.data.result_image}`;
        }

        const taskId = genRes.data.data.task_id;
        if (!taskId) {
            throw new Error("No task ID returned.");
        }

        return this._pollStatus(taskId, requestNonce);
    }
}

export default FaceSwap;
