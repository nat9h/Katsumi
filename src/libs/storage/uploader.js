/**
 * @fileoverview File uploader to temporary hosting services.
 * @module storage/uploader
 */

import { fileTypeFromBuffer } from "file-type";

async function guessName(buffer, filename) {
    if (filename) {
        return filename;
    }
    const type = await fileTypeFromBuffer(buffer);
    return `file.${type?.ext || "bin"}`;
}

/**
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<string>}
 */
export async function catbox(buffer, filename) {
    const { fileTypeFromBuffer } = await import("file-type");
    const type = await fileTypeFromBuffer(buffer);
    const ext = type?.ext || "bin";
    const mime = type?.mime || "application/octet-stream";
    const blob = new Blob([buffer], { type: mime });
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", blob, filename || `upload.${ext}`);

    const res = await fetch("https://catbox.moe/user/api.php", {
        method: "POST",
        body: form,
    });
    const text = await res.text();
    if (!text.startsWith("http")) {
        throw new Error(`Catbox: ${text}`);
    }
    return text.trim();
}

/**
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @param {"1h"|"12h"|"24h"|"72h"} [time="1h"]
 * @returns {Promise<string>}
 */
export async function litterbox(buffer, filename, time = "1h") {
    const name = await guessName(buffer, filename);
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("time", time);
    form.append("fileToUpload", new File([buffer], name));

    const res = await fetch(
        "https://litterbox.catbox.moe/resources/internals/api.php",
        {
            method: "POST",
            body: form,
        },
    );
    const text = await res.text();
    if (!text.startsWith("http")) {
        throw new Error(`Litterbox: ${text}`);
    }
    return text.trim();
}

/**
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<string>}
 */
export async function tmpfiles(buffer, filename) {
    const name = await guessName(buffer, filename);
    const form = new FormData();
    form.append("file", new File([buffer], name));

    const res = await fetch("https://tmpfiles.org/api/v1/upload", {
        method: "POST",
        body: form,
    });
    const json = await res.json();
    if (!json?.data?.url) {
        throw new Error(`Tmpfiles: ${JSON.stringify(json)}`);
    }
    return json.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
}

/**
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<string>}
 */
export async function uguu(buffer, filename) {
    const { fileTypeFromBuffer } = await import("file-type");
    const type = await fileTypeFromBuffer(buffer);
    const ext = type?.ext || "bin";
    const mime = type?.mime || "application/octet-stream";
    const blob = new Blob([buffer], { type: mime });
    const form = new FormData();
    form.append("files[]", blob, filename || `file.${ext}`);

    const res = await fetch("https://uguu.se/upload.php", {
        method: "POST",
        body: form,
    });
    const json = await res.json();
    if (!json?.files?.[0]?.url) {
        throw new Error(`Uguu: ${JSON.stringify(json)}`);
    }
    return json.files[0].url;
}

/**
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @param {"catbox"|"litterbox"|"tmpfiles"|"uguu"|"imgur"} [provider="catbox"]
 * @returns {Promise<string>}
 */
export async function upload(buffer, filename, provider = "catbox") {
    const providers = { catbox, litterbox, tmpfiles, uguu, imgur };
    const fn = providers[provider] || catbox;
    return fn(buffer, filename);
}

/**
 * Upload image to Imgur (anonymous, no API key needed for small usage).
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function imgur(buffer) {
    const base64 = buffer.toString("base64");
    const form = new FormData();
    form.append("image", base64);
    form.append("type", "base64");

    const res = await fetch("https://api.imgur.com/3/image", {
        method: "POST",
        headers: {
            Authorization: "Client-ID 546c25a59c58ad7",
        },
        body: form,
    });
    const json = await res.json();
    if (!json?.data?.link) {
        throw new Error(`Imgur: ${JSON.stringify(json)}`);
    }
    return json.data.link;
}
