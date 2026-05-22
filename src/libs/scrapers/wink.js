/**
 * @fileoverview Video HD enhancer via wink.ai (no API key needed).
 * Uploads video → transcodes → enhances to Ultra HD → returns result URL.
 * @module scrapers/wink
 */

import crypto from "node:crypto";
import path from "node:path";
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import FormData from "form-data";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function sentryHeaders() {
    const trace = `${crypto.randomBytes(16).toString("hex")}-${crypto.randomBytes(8).toString("hex")}-1`;
    return {
        "sentry-trace": trace,
        baggage: [
            "sentry-environment=release",
            "sentry-release=5.1.2%20(b60d25c477f43c6dfac4107810f26d442320f4f1)",
            "sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54",
            `sentry-trace_id=${trace.split("-")[0]}`,
            "sentry-sampled=true",
            "sentry-sample_rate=0.75",
        ].join(","),
    };
}

function params(gnum, extra = {}) {
    return new URLSearchParams({
        client_id: "1189857605",
        version: "5.1.2",
        country_code: "ID",
        gnum,
        client_language: "en_US",
        client_channel_id: "",
        client_timezone: "Asia/Jakarta",
        ...extra,
    });
}

export class WinkUpscaler {
    static #API = "https://wink.ai";
    static #STORAGE = "https://strategy.app.meitudata.com";
    static #AGENT =
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

    constructor({ timeout = 300_000 } = {}) {
        this.timeout = timeout;
    }

    /**
     * Enhance a video to Ultra HD.
     * @param {Buffer} buffer - Video buffer
     * @param {{ filename?: string }} [opts]
     * @returns {Promise<{ buffer: Buffer, resultUrl: string }>}
     */
    async upscaleVideo(buffer, { filename = "video.mp4" } = {}) {
        if (!buffer || !Buffer.isBuffer(buffer)) {
            throw new Error("Video buffer is required.");
        }

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

        const common = {
            accept: "*/*",
            origin: WinkUpscaler.#API,
            referer: `${WinkUpscaler.#API}/video-enhancer/upload`,
            "user-agent": WinkUpscaler.#AGENT,
            "sec-ch-ua":
                '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
            "sec-ch-ua-mobile": "?1",
            "sec-ch-ua-platform": '"Android"',
            ab_info: JSON.stringify({ ab_codes: [], version: "1.4.4" }),
        };

        const ext = `.${filename.split(".").pop()?.toLowerCase() || "mp4"}`;
        const sign = await axios.get(
            `${WinkUpscaler.#API}/api/file/get_maat_sign.json?${params(id, { suffix: ext, type: "temp", count: "1" })}`,
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

        const { app, count, sig, sig_time, sig_version, suffix, type } =
            sign.data.data;
        const policy = await axios.get(
            `${WinkUpscaler.#STORAGE}/upload/policy?${new URLSearchParams({ app, count: String(count), sig, sigTime: sig_time, sigVersion: sig_version, suffix, type })}`,
            {
                headers: {
                    accept: "*/*",
                    origin: WinkUpscaler.#API,
                    referer: `${WinkUpscaler.#API}/`,
                    "user-agent": WinkUpscaler.#AGENT,
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
        const mime = detected?.mime || "video/mp4";
        const form = new FormData();
        form.append("file", buffer, { filename, contentType: mime });
        form.append("token", token);
        form.append("key", key);
        form.append("fname", filename);

        const upload = await axios.post(uploadUrl, form, {
            headers: form.getHeaders({
                origin: WinkUpscaler.#API,
                referer: `${WinkUpscaler.#API}/`,
                "user-agent": WinkUpscaler.#AGENT,
                accept: "*/*",
            }),
            maxBodyLength: Infinity,
            validateStatus: () => true,
        });
        if (upload.status >= 400) {
            throw new Error(`Upload failed: HTTP ${upload.status}`);
        }

        const post = {
            ...common,
            ...sentryHeaders(),
            cookie: cookie(),
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        };

        await axios.post(
            `${WinkUpscaler.#API}/api/file/video_cover_and_display_info_ext.json`,
            params(id, { file_key: key }).toString(),
            { headers: post, validateStatus: () => true },
        );

        const transcode = await axios.post(
            `${WinkUpscaler.#API}/api/file/video_trans_start.json`,
            params(id, { file_key: key }).toString(),
            { headers: post, validateStatus: () => true },
        );
        if (transcode.data?.code !== 0 || !transcode.data?.data?.id) {
            throw new Error(
                `Transcode failed: ${JSON.stringify(transcode.data).slice(0, 200)}`,
            );
        }

        const video = await this.#pollTranscode(
            id,
            transcode.data.data.id,
            common,
            cookie,
            saveCookies,
        );

        const delivery = await axios.post(
            `${WinkUpscaler.#API}/api/meitu_ai/delivery.json`,
            params(id, {
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
                    url: "https://wink.ai/video-enhancer/upload",
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

        const resultUrl = await this.#pollResult(id, taskId, common, cookie);

        const result = await axios.get(resultUrl, {
            responseType: "arraybuffer",
            timeout: 60_000,
        });
        return { buffer: Buffer.from(result.data), resultUrl };
    }

    async #pollTranscode(id, transcodeId, common, cookie, saveCookies) {
        const start = Date.now();
        while (Date.now() - start < Math.min(this.timeout, 180_000)) {
            await delay(3000);
            const res = await axios.get(
                `${WinkUpscaler.#API}/api/file/video_trans_query.json?${params(id, { id: transcodeId })}`,
                {
                    headers: {
                        ...common,
                        ...sentryHeaders(),
                        cookie: cookie(),
                    },
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

    async #pollResult(id, initialTaskId, common, cookie) {
        const start = Date.now();
        let taskId = initialTaskId;

        while (Date.now() - start < this.timeout) {
            await delay(5000);
            const res = await axios.get(
                `${WinkUpscaler.#API}/api/meitu_ai/query_batch.json?${params(id, { msg_ids: taskId })}`,
                {
                    headers: {
                        ...common,
                        ...sentryHeaders(),
                        cookie: cookie(),
                        referer: `${WinkUpscaler.#API}/video-enhancer/upload`,
                    },
                    validateStatus: () => true,
                },
            );

            const item = res.data?.data?.item_list?.[0];
            const redirect = item?.result?.result || "";
            const altId = item?.result?.msg_id || item?.msg_id || "";

            if (
                redirect &&
                redirect !== taskId &&
                !redirect.startsWith("http")
            ) {
                taskId = redirect;
                continue;
            }
            if (altId && altId !== taskId && !altId.startsWith("wpr_")) {
                taskId = altId;
                continue;
            }

            const url =
                item?.result?.media_info_list?.[0]?.media_data ||
                item?.result?.result_url ||
                item?.result?.url ||
                "";
            const errCode = item?.result?.error_code;

            if (url?.startsWith("http") && errCode === 0) {
                return url;
            }
            if (errCode && errCode !== 29901 && errCode !== 0) {
                throw new Error(
                    `Enhance failed: ${errCode} ${item?.result?.error_msg || ""}`,
                );
            }
        }
        throw new Error("Enhance timed out.");
    }
}

export default WinkUpscaler;
