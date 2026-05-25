/**
 * @fileoverview Image & Video HD enhancer via wink.ai (no API key needed).
 * Uploads media → enhances to Ultra HD → returns result buffer + URL.
 * @module scrapers/wink
 */

import crypto from "node:crypto";
import path from "node:path";
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import FormData from "form-data";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = "https://wink.ai";
const storage = "https://strategy.app.meitudata.com";
const ua =
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

/** Generate sentry tracing headers for request authenticity. */
function sentryHeaders() {
    const traceId = crypto.randomBytes(16).toString("hex");
    const spanId = crypto.randomBytes(8).toString("hex");
    const trace = `${traceId}-${spanId}-1`;
    return {
        "sentry-trace": trace,
        baggage: [
            "sentry-environment=release",
            "sentry-release=5.1.2%20(b60d25c477f43c6dfac4107810f26d442320f4f1)",
            "sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54",
            `sentry-trace_id=${traceId}`,
            "sentry-sampled=true",
            "sentry-sample_rate=0.75",
        ].join(","),
    };
}

/** Build common query params for wink API calls. */
function baseParams(sessionId, extra = {}) {
    return new URLSearchParams({
        client_id: "1189857605",
        version: "5.1.2",
        country_code: "ID",
        gnum: sessionId,
        client_language: "en_US",
        client_channel_id: "",
        client_timezone: "Asia/Jakarta",
        ...extra,
    });
}

/** Creates a session context (cookies, headers) for a single enhance job. */
function createSession(mediaType) {
    const id = crypto.randomUUID();
    const jar = {
        _sm: id,
        meitustat: encodeURIComponent(JSON.stringify({ wgid: id })),
    };

    const cookie = () =>
        Object.entries(jar)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ");

    const saveCookies = (res) => {
        const raw = res.headers["set-cookie"];
        if (!raw) {
            return;
        }
        for (const entry of Array.isArray(raw) ? raw : [raw]) {
            const match = entry.match(/^([^=]+)=([^;]*)/);
            if (match) {
                jar[match[1].trim()] = match[2].trim();
            }
        }
    };

    const refererPath =
        mediaType === "video" ? "video-enhancer" : "image-enhancer";

    const common = {
        accept: "*/*",
        origin: api,
        referer: `${api}/${refererPath}/upload`,
        "user-agent": ua,
        "sec-ch-ua":
            '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
        ab_info: JSON.stringify({ ab_codes: [], version: "1.4.4" }),
    };

    const postHeaders = () => ({
        ...common,
        ...sentryHeaders(),
        cookie: cookie(),
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    });

    return { id, jar, cookie, saveCookies, common, postHeaders };
}

/**
 * Upload a buffer to wink's storage. Returns the file key and source URL.
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {object} session - Session context from createSession()
 * @returns {Promise<{ key: string, sourceUrl: string }>}
 */
async function uploadFile(buffer, filename, session) {
    const { id, common, cookie, saveCookies } = session;

    const ext = path.extname(filename).toLowerCase() || ".jpg";
    const suffix = ext === ".jpeg" ? ".jpg" : ext;

    const sign = await axios.get(
        `${api}/api/file/get_maat_sign.json?${baseParams(id, { suffix, type: "temp", count: "1" })}`,
        {
            headers: { ...common, ...sentryHeaders(), cookie: cookie() },
            validateStatus: () => true,
        },
    );
    saveCookies(sign);

    if (sign.data?.code !== 0) {
        throw new Error(
            `Upload sign failed: ${JSON.stringify(sign.data).slice(0, 200)}`,
        );
    }

    const {
        app,
        count,
        sig,
        sig_time,
        sig_version,
        suffix: sSuffix,
        type,
    } = sign.data.data;

    const policy = await axios.get(
        `${storage}/upload/policy?${new URLSearchParams({
            app,
            count: String(count),
            sig,
            sigTime: sig_time,
            sigVersion: sig_version,
            suffix: sSuffix,
            type,
        })}`,
        {
            headers: {
                accept: "*/*",
                origin: api,
                referer: `${api}/`,
                "user-agent": ua,
            },
            validateStatus: () => true,
        },
    );

    if (!Array.isArray(policy.data) || !policy.data[0]?.qiniu) {
        throw new Error(
            `Upload policy failed: ${JSON.stringify(policy.data).slice(0, 200)}`,
        );
    }

    const { url: uploadUrl, token, key } = policy.data[0].qiniu;

    const detected = await fileTypeFromBuffer(buffer);
    const mime =
        detected?.mime || (suffix.includes("mp4") ? "video/mp4" : "image/jpeg");

    const form = new FormData();
    form.append("file", buffer, { filename, contentType: mime });
    form.append("token", token);
    form.append("key", key);
    form.append("fname", filename);

    const upload = await axios.post(uploadUrl, form, {
        headers: form.getHeaders({
            origin: api,
            referer: `${api}/`,
            "user-agent": ua,
            accept: "*/*",
        }),
        maxBodyLength: Infinity,
        validateStatus: () => true,
    });

    if (upload.status >= 400) {
        throw new Error(`Upload failed: HTTP ${upload.status}`);
    }

    const sourceUrl =
        upload.data?.url ||
        upload.data?.data ||
        policy.data[0].qiniu.data ||
        "";

    if (!sourceUrl) {
        throw new Error("Upload did not return source URL.");
    }

    return { key, sourceUrl };
}

/**
 * Poll the enhance result until complete or timeout.
 * Works for both image and video — only differs in poll interval and referer.
 */
async function pollEnhanceResult(
    sessionId,
    initialTaskId,
    common,
    cookie,
    {
        interval = 3000,
        timeout = 300_000,
        referer = `${api}/image-enhancer/upload`,
    } = {},
) {
    const start = Date.now();
    let taskId = initialTaskId;

    while (Date.now() - start < timeout) {
        await sleep(interval);

        const res = await axios.get(
            `${api}/api/meitu_ai/query_batch.json?${baseParams(sessionId, { msg_ids: taskId })}`,
            {
                headers: {
                    ...common,
                    ...sentryHeaders(),
                    cookie: cookie(),
                    referer,
                },
                validateStatus: () => true,
            },
        );

        const item = res.data?.data?.item_list?.[0];
        if (!item) {
            continue;
        }

        const redirect = item.result?.result || "";
        const altId = item.result?.msg_id || item.msg_id || "";

        if (redirect && redirect !== taskId && !redirect.startsWith("http")) {
            taskId = redirect;
            await sleep(1000);
            continue;
        }
        if (altId && altId !== taskId && !altId.startsWith("wpr_")) {
            taskId = altId;
            await sleep(1000);
            continue;
        }

        const url =
            item.result?.media_info_list?.[0]?.media_data ||
            item.result?.result_url ||
            item.result?.url ||
            "";
        const errCode = item.result?.error_code;

        if (url?.startsWith("http") && errCode === 0) {
            return url;
        }
        if (errCode && errCode !== 29901 && errCode !== 0) {
            throw new Error(
                `Enhance failed: ${errCode} ${item.result?.error_msg || ""}`,
            );
        }
    }

    throw new Error("Enhance timed out.");
}

/** Poll video transcode until source + transcoded URLs are available. */
async function pollTranscode(
    sessionId,
    transcodeId,
    common,
    cookie,
    saveCookies,
    timeout,
) {
    const start = Date.now();
    const maxWait = Math.min(timeout, 180_000);

    while (Date.now() - start < maxWait) {
        await sleep(3000);

        const res = await axios.get(
            `${api}/api/file/video_trans_query.json?${baseParams(sessionId, { id: transcodeId })}`,
            {
                headers: { ...common, ...sentryHeaders(), cookie: cookie() },
                validateStatus: () => true,
            },
        );
        saveCookies(res);

        const data = res.data?.data;
        const source = data?.video || data?.url || data?.source_url || "";
        let transcoded =
            data?.video_transcoded ||
            data?.transcoded_video ||
            data?.video_url ||
            "";

        if (!transcoded && data?.status === 2 && source) {
            transcoded = source;
        }
        if (transcoded) {
            return { source: source || transcoded, transcoded };
        }
    }

    throw new Error("Transcode timed out.");
}

async function downloadResult(url) {
    const { data } = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 60_000,
    });
    return Buffer.from(data);
}

export class WinkUpscaler {
    constructor({ timeout = 300_000 } = {}) {
        this.timeout = timeout;
    }

    /**
     * Enhance an image to Ultra HD.
     * @param {Buffer} buffer - Image buffer (jpg/png/webp)
     * @param {{ filename?: string }} [opts]
     * @returns {Promise<{ buffer: Buffer, resultUrl: string }>}
     */
    async upscaleImage(buffer, { filename = "image.jpg" } = {}) {
        if (!Buffer.isBuffer(buffer)) {
            throw new Error("Image buffer is required.");
        }

        const session = createSession("image");
        const { id, common, cookie, postHeaders } = session;

        const { key, sourceUrl } = await uploadFile(buffer, filename, session);

        const post = postHeaders();

        await axios.post(
            `${api}/api/file/meta_info.json`,
            baseParams(id, { file_key: key }).toString(),
            { headers: post, validateStatus: () => true },
        );

        await axios.post(
            `${api}/api/subscribe/batch_calc_need_beans.json`,
            baseParams(id, {
                item_list: JSON.stringify([
                    {
                        type: 12,
                        ext_value: "2",
                        content_type: 1,
                        duration: 0,
                        type_params: JSON.stringify({
                            is_mirror: 0,
                            orientation_tag: 1,
                            j_420_trans: "1",
                            return_ext: "2",
                        }),
                        right_detail: JSON.stringify({
                            source: "1",
                            touch_type: "4",
                            function_id: "630",
                            material_id: "63011",
                            url: `${api}/image-enhancer/upload`,
                        }),
                    },
                ]),
            }).toString(),
            { headers: post, validateStatus: () => true },
        );

        const delivery = await axios.post(
            `${api}/api/meitu_ai/delivery.json`,
            baseParams(id, {
                type: "12",
                content_type: "1",
                source_url: sourceUrl,
                type_params: JSON.stringify({
                    is_mirror: 0,
                    orientation_tag: 1,
                    j_420_trans: "1",
                    return_ext: "2",
                }),
                right_detail: JSON.stringify({
                    source: "1",
                    touch_type: "4",
                    function_id: "630",
                    material_id: "63011",
                    url: `${api}/image-enhancer/upload`,
                }),
                ext_params: JSON.stringify({
                    task_name: `Enhancer-Ultra HD-${path.parse(filename).name}`,
                    records: "12",
                }),
                with_prepare: "1",
            }).toString(),
            { headers: post, validateStatus: () => true },
        );

        if (delivery.data?.code !== 0) {
            throw new Error(
                `Delivery failed: ${JSON.stringify(delivery.data).slice(0, 200)}`,
            );
        }

        const taskId =
            delivery.data.data?.msg_id ||
            delivery.data.data?.prepare_msg_id ||
            "";
        if (!taskId) {
            throw new Error("Delivery did not return task ID.");
        }

        const resultUrl = await pollEnhanceResult(id, taskId, common, cookie, {
            interval: 3000,
            timeout: this.timeout,
            referer: `${api}/image-enhancer/upload`,
        });

        return { buffer: await downloadResult(resultUrl), resultUrl };
    }

    /**
     * Enhance a video to Ultra HD.
     * @param {Buffer} buffer - Video buffer
     * @param {{ filename?: string }} [opts]
     * @returns {Promise<{ buffer: Buffer, resultUrl: string }>}
     */
    async upscaleVideo(buffer, { filename = "video.mp4" } = {}) {
        if (!Buffer.isBuffer(buffer)) {
            throw new Error("Video buffer is required.");
        }

        const session = createSession("video");
        const { id, common, cookie, saveCookies, postHeaders } = session;

        const { key } = await uploadFile(buffer, filename, session);

        const post = postHeaders();

        await axios.post(
            `${api}/api/file/video_cover_and_display_info_ext.json`,
            baseParams(id, { file_key: key }).toString(),
            { headers: post, validateStatus: () => true },
        );

        const transcode = await axios.post(
            `${api}/api/file/video_trans_start.json`,
            baseParams(id, { file_key: key }).toString(),
            { headers: post, validateStatus: () => true },
        );

        if (transcode.data?.code !== 0 || !transcode.data?.data?.id) {
            throw new Error(
                `Transcode failed: ${JSON.stringify(transcode.data).slice(0, 200)}`,
            );
        }

        const video = await pollTranscode(
            id,
            transcode.data.data.id,
            common,
            cookie,
            saveCookies,
            this.timeout,
        );

        const delivery = await axios.post(
            `${api}/api/meitu_ai/delivery.json`,
            baseParams(id, {
                type: "11",
                content_type: "2",
                source_url: video.source,
                type_params: JSON.stringify({
                    is_mirror: 0,
                    orientation_tag: 1,
                    j_420_trans: "1",
                    return_ext: "2",
                }),
                right_detail: JSON.stringify({
                    source: "1",
                    touch_type: "4",
                    function_id: "630",
                    material_id: "63011",
                    url: `${api}/video-enhancer/upload`,
                }),
                ext_params: JSON.stringify({
                    task_name: `Enhancer-Ultra HD-${path.parse(filename).name}`,
                    records: "11",
                    video_transcoded: video.transcoded,
                }),
                with_prepare: "1",
            }).toString(),
            { headers: post, validateStatus: () => true },
        );

        if (delivery.data?.code !== 0) {
            throw new Error(
                `Delivery failed: ${JSON.stringify(delivery.data).slice(0, 200)}`,
            );
        }

        const taskId =
            delivery.data.data?.msg_id ||
            delivery.data.data?.prepare_msg_id ||
            "";
        if (!taskId) {
            throw new Error("Delivery did not return task ID.");
        }

        const resultUrl = await pollEnhanceResult(id, taskId, common, cookie, {
            interval: 5000,
            timeout: this.timeout,
            referer: `${api}/video-enhancer/upload`,
        });

        return { buffer: await downloadResult(resultUrl), resultUrl };
    }
}

export default WinkUpscaler;
