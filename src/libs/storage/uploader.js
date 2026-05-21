/**
 * @fileoverview File uploader to temporary hosting services.
 * @module storage/uploader
 */

import { fileTypeFromBuffer } from "file-type";

/**
 * Detect mime/ext from buffer and build a Blob with proper name.
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<{ blob: Blob, name: string }>}
 */
async function prepare(buffer, filename) {
    const type = await fileTypeFromBuffer(buffer);
    const ext = type?.ext || "bin";
    const mime = type?.mime || "application/octet-stream";
    const name = filename || `file.${ext}`;
    const blob = new Blob([buffer], { type: mime });
    return { blob, name };
}

/**
 * Upload to Catbox (permanent, 200MB max).
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<string>}
 */
export async function catbox(buffer, filename) {
    const { blob, name } = await prepare(buffer, filename);
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", blob, name);

    const res = await fetch("https://catbox.moe/user/api.php", {
        method: "POST",
        body: form,
    });
    const text = await res.text();
    if (!text.startsWith("http")) {
        throw new Error(`Catbox: ${text.slice(0, 200)}`);
    }
    return text.trim();
}

/**
 * Upload to Litterbox (temporary, configurable expiry).
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @param {"1h"|"12h"|"24h"|"72h"} [time="1h"]
 * @returns {Promise<string>}
 */
export async function litterbox(buffer, filename, time = "1h") {
    const { blob, name } = await prepare(buffer, filename);
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("time", time);
    form.append("fileToUpload", blob, name);

    const res = await fetch(
        "https://litterbox.catbox.moe/resources/internals/api.php",
        { method: "POST", body: form },
    );
    const text = await res.text();
    if (!text.startsWith("http")) {
        throw new Error(`Litterbox: ${text.slice(0, 200)}`);
    }
    return text.trim();
}

/**
 * Upload to tmpfiles.org (temporary, auto-expires).
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<string>}
 */
export async function tmpfiles(buffer, filename) {
    const { name } = await prepare(buffer, filename);
    const form = new FormData();
    form.append("file", new File([buffer], name));

    const res = await fetch("https://tmpfiles.org/api/v1/upload", {
        method: "POST",
        body: form,
    });
    const json = await res.json();
    if (!json?.data?.url) {
        throw new Error(`Tmpfiles: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return json.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
}

/**
 * Upload to Uguu (temporary, 48h).
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<string>}
 */
export async function uguu(buffer, filename) {
    const { blob, name } = await prepare(buffer, filename);
    const form = new FormData();
    form.append("files[]", blob, name);

    const res = await fetch("https://uguu.se/upload.php", {
        method: "POST",
        body: form,
    });
    const json = await res.json();
    if (!json?.files?.[0]?.url) {
        throw new Error(`Uguu: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return json.files[0].url;
}

/**
 * Upload image to Imgur (anonymous).
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function imgur(buffer) {
    const form = new FormData();
    form.append("image", buffer.toString("base64"));
    form.append("type", "base64");

    const res = await fetch("https://api.imgur.com/3/image", {
        method: "POST",
        headers: { Authorization: "Client-ID 546c25a59c58ad7" },
        body: form,
    });
    const json = await res.json();
    if (!json?.data?.link) {
        throw new Error(`Imgur: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return json.data.link;
}

/**
 * Upload to GoFile (unlimited size, no auth, permanent until inactive).
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<string>}
 */
export async function gofile(buffer, filename) {
    const { name } = await prepare(buffer, filename);

    const srv = await fetch("https://api.gofile.io/servers").then((r) =>
        r.json(),
    );
    const server = srv?.data?.servers?.[0]?.name;
    if (!server) {
        throw new Error("GoFile: no server available");
    }

    const form = new FormData();
    form.append("file", new File([buffer], name));

    const res = await fetch(`https://${server}.gofile.io/contents/uploadfile`, {
        method: "POST",
        body: form,
    });
    const json = await res.json();
    if (json.status !== "ok" || !json.data?.downloadPage) {
        throw new Error(`GoFile: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return json.data.downloadPage;
}

/**
 * Upload to x0.at (100MB max, temporary).
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<string>}
 */
export async function x0(buffer, filename) {
    const { blob, name } = await prepare(buffer, filename);
    const form = new FormData();
    form.append("file", blob, name);

    const res = await fetch("https://x0.at/", {
        method: "POST",
        body: form,
    });
    const text = await res.text();
    if (!res.ok || !text.startsWith("http")) {
        throw new Error(`x0.at: ${text.slice(0, 200)}`);
    }
    return text.trim();
}

/**
 * Upload using a named provider.
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @param {"catbox"|"litterbox"|"tmpfiles"|"uguu"|"imgur"|"gofile"|"x0"} [provider="catbox"]
 * @returns {Promise<string>}
 */
export async function upload(buffer, filename, provider = "catbox") {
    const providers = { catbox, litterbox, tmpfiles, uguu, imgur, gofile, x0 };
    const fn = providers[provider] || catbox;
    return fn(buffer, filename);
}
