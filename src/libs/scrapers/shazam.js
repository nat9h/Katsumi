/**
 * @fileoverview Shazam Music Recognition Scraper
 * Shazam Music Recognition algorithm (FFT, peak spreading, peak recognition, binary signature encoding).
 * @author natsumiworld / kath
 * @module scrapers/shazam
 */

import fs from "node:fs";
import { decodeToRawPCM } from "#libs/utils/converter/media";

/**
 * Audio fingerprint signature generator.
 * Implements FFT-based peak detection and binary encoding for Shazam recognition.
 */
class SignatureGenerator {
    /** @type {number} Target sample rate for audio processing. */
    static sampleRate = 16000;
    /** @type {number} FFT window size. */
    static fftSize = 2048;
    /** @type {number} Number of frequency bins (fftSize/2 + 1). */
    static bins = 1025;

    /** @type {Float32Array} Pre-computed Hanning window coefficients. */
    static hanningWindow = (() => {
        const w = new Float32Array(2048);
        for (let i = 0; i < 2048; i++) {
            w[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / 2047));
        }
        return w;
    })();

    /** @type {Uint32Array} Pre-computed CRC32 lookup table. */
    static crc32Table = (() => {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let crc = i;
            for (let j = 0; j < 8; j++) {
                crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
            }
            table[i] = crc;
        }
        return table;
    })();

    constructor() {
        this.ringBufferOfSamples = new Int16Array(2048);
        this.ringBufferIndex = 0;
        this.reorderedBuffer = new Float32Array(2048);

        this.fftOutputs = Array.from(
            { length: 256 },
            () => new Float32Array(1025),
        );
        this.fftOutputsIndex = 0;

        this.spreadFftOutputs = Array.from(
            { length: 256 },
            () => new Float32Array(1025),
        );
        this.spreadFftOutputsIndex = 0;

        this.numSpreadFftsDone = 0;
        this.frequencyBandToPeaks = new Map();
    }

    /**
     * Compute CRC32 checksum of a buffer.
     * @param {Buffer} buf - Input buffer.
     * @param {number} [startOffset=0] - Byte offset to start from.
     * @returns {number} CRC32 checksum as unsigned 32-bit integer.
     */
    static crc32(buf, startOffset = 0) {
        let crc = 0xffffffff;
        for (let i = startOffset; i < buf.length; i++) {
            crc =
                (crc >>> 8) ^
                SignatureGenerator.crc32Table[(crc ^ buf[i]) & 0xff];
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    /**
     * Perform a real-valued 2048-point FFT using Cooley-Tukey algorithm.
     * @param {Float32Array} input - 2048 windowed time-domain samples.
     * @returns {Float32Array} 1025 magnitude-squared frequency bins (normalized by 1<<17).
     */
    static fft(input) {
        const n = 2048;
        const real = new Float32Array(n);
        const imag = new Float32Array(n);
        real.set(input);

        let j = 0;
        for (let i = 1; i < n; i++) {
            let bit = n >> 1;
            while (j & bit) {
                j ^= bit;
                bit >>= 1;
            }
            j ^= bit;
            if (i < j) {
                [real[i], real[j]] = [real[j], real[i]];
                [imag[i], imag[j]] = [imag[j], imag[i]];
            }
        }

        for (let len = 2; len <= n; len <<= 1) {
            const halfLen = len >> 1;
            const angle = (-2 * Math.PI) / len;
            const wR = Math.cos(angle);
            const wI = Math.sin(angle);
            for (let i = 0; i < n; i += len) {
                let curR = 1,
                    curI = 0;
                for (let k = 0; k < halfLen; k++) {
                    const eIdx = i + k;
                    const oIdx = i + k + halfLen;
                    const tR = curR * real[oIdx] - curI * imag[oIdx];
                    const tI = curR * imag[oIdx] + curI * real[oIdx];
                    real[oIdx] = real[eIdx] - tR;
                    imag[oIdx] = imag[eIdx] - tI;
                    real[eIdx] += tR;
                    imag[eIdx] += tI;
                    const newCurR = curR * wR - curI * wI;
                    curI = curR * wI + curI * wR;
                    curR = newCurR;
                }
            }
        }

        const output = new Float32Array(1025);
        const divisor = 1 << 17;
        for (let i = 0; i <= 1024; i++) {
            output[i] = Math.max(
                1e-10,
                (real[i] * real[i] + imag[i] * imag[i]) / divisor,
            );
        }
        return output;
    }

    /**
     * Process raw PCM samples and extract frequency peaks grouped by band.
     * @param {Int16Array} samples - s16le mono 16kHz audio samples.
     * @returns {Map<number, Array<{fftPassNumber: number, peakMagnitude: number, correctedPeakFrequencyBin: number}>>}
     */
    static fromSamples(samples) {
        const gen = new SignatureGenerator();
        const chunkSize = 128;
        const numChunks = Math.floor(samples.length / chunkSize);

        for (let i = 0; i < numChunks; i++) {
            const chunk = samples.subarray(i * chunkSize, (i + 1) * chunkSize);
            gen.doFft(chunk);
            gen.doPeakSpreading();
            gen.numSpreadFftsDone++;
            if (gen.numSpreadFftsDone >= 46) {
                gen.doPeakRecognition();
            }
        }
        return gen.frequencyBandToPeaks;
    }

    /**
     * Feed 128 samples into the ring buffer and compute FFT.
     * @param {Int16Array} chunk - 128 audio samples.
     */
    doFft(chunk) {
        for (let i = 0; i < 128; i++) {
            this.ringBufferOfSamples[this.ringBufferIndex + i] = chunk[i];
        }
        this.ringBufferIndex += 128;
        this.ringBufferIndex &= 2047;

        for (let i = 0; i < 2048; i++) {
            this.reorderedBuffer[i] =
                this.ringBufferOfSamples[(i + this.ringBufferIndex) & 2047] *
                SignatureGenerator.hanningWindow[i];
        }

        const fftResult = SignatureGenerator.fft(this.reorderedBuffer);
        this.fftOutputs[this.fftOutputsIndex].set(fftResult);
        this.fftOutputsIndex = (this.fftOutputsIndex + 1) & 255;
    }

    /**
     * Apply frequency and time-domain peak spreading to the latest FFT output.
     * Spreads energy to neighboring bins/frames to create a robust fingerprint.
     */
    doPeakSpreading() {
        const srcIdx = (this.fftOutputsIndex - 1 + 256) & 255;
        const realFftResults = this.fftOutputs[srcIdx];
        const spreadResults = this.spreadFftOutputs[this.spreadFftOutputsIndex];

        spreadResults.set(realFftResults);

        for (let pos = 0; pos <= 1022; pos++) {
            spreadResults[pos] = Math.max(
                spreadResults[pos],
                spreadResults[pos + 1],
                spreadResults[pos + 2],
            );
        }

        for (const offset of [1, 3, 6]) {
            const formerIdx = (this.spreadFftOutputsIndex - offset + 256) & 255;
            const formerFft = this.spreadFftOutputs[formerIdx];
            for (let pos = 0; pos <= 1024; pos++) {
                if (spreadResults[pos] > formerFft[pos]) {
                    formerFft[pos] = spreadResults[pos];
                }
            }
        }

        this.spreadFftOutputsIndex = (this.spreadFftOutputsIndex + 1) & 255;
    }

    /**
     * Identify spectral peaks by comparing FFT magnitudes against spread neighbors.
     * Peaks that survive both frequency and time-domain checks are stored by band.
     */
    doPeakRecognition() {
        const fftMinus46Idx = (this.fftOutputsIndex - 46 + 256) & 255;
        const spreadMinus49Idx = (this.spreadFftOutputsIndex - 49 + 256) & 255;

        const fftMinus46 = this.fftOutputs[fftMinus46Idx];
        const fftMinus49 = this.spreadFftOutputs[spreadMinus49Idx];

        for (let binPos = 10; binPos <= 1014; binPos++) {
            if (
                fftMinus46[binPos] < 1.0 / 64.0 ||
                fftMinus46[binPos] < fftMinus49[binPos - 1]
            ) {
                continue;
            }

            let maxNeighbor = 0;
            for (const off of [-10, -7, -4, -3, 1, 2, 5, 8]) {
                const val = fftMinus49[binPos + off];
                if (val > maxNeighbor) {
                    maxNeighbor = val;
                }
            }

            if (fftMinus46[binPos] <= maxNeighbor) {
                continue;
            }

            let maxOther = maxNeighbor;
            for (const off of [
                -53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242,
                249,
            ]) {
                const otherIdx =
                    (this.spreadFftOutputsIndex + off + 256 * 4) & 255;
                const otherFft = this.spreadFftOutputs[otherIdx];
                if (otherFft[binPos - 1] > maxOther) {
                    maxOther = otherFft[binPos - 1];
                }
            }

            if (fftMinus46[binPos] <= maxOther) {
                continue;
            }

            const fftPassNumber = this.numSpreadFftsDone - 46;
            const peakMag =
                Math.log(Math.max(fftMinus46[binPos], 1.0 / 64.0)) * 1477.3 +
                6144.0;
            const peakMagBefore =
                Math.log(Math.max(fftMinus46[binPos - 1], 1.0 / 64.0)) *
                    1477.3 +
                6144.0;
            const peakMagAfter =
                Math.log(Math.max(fftMinus46[binPos + 1], 1.0 / 64.0)) *
                    1477.3 +
                6144.0;

            const peakVar1 = peakMag * 2.0 - peakMagBefore - peakMagAfter;
            const peakVar2 = ((peakMagAfter - peakMagBefore) * 32.0) / peakVar1;
            const correctedBin = (binPos * 64 + Math.round(peakVar2)) & 0xffff;

            const freqHz = correctedBin * (16000.0 / 2.0 / 1024.0 / 64.0);

            let band = -1;
            if (freqHz >= 250 && freqHz < 520) {
                band = 0;
            } else if (freqHz >= 520 && freqHz < 1450) {
                band = 1;
            } else if (freqHz >= 1450 && freqHz < 3500) {
                band = 2;
            } else if (freqHz >= 3500 && freqHz <= 5500) {
                band = 3;
            }

            if (band >= 0) {
                if (!this.frequencyBandToPeaks.has(band)) {
                    this.frequencyBandToPeaks.set(band, []);
                }
                this.frequencyBandToPeaks.get(band).push({
                    fftPassNumber,
                    peakMagnitude: Math.round(peakMag) & 0xffff,
                    correctedPeakFrequencyBin: correctedBin,
                });
            }
        }
    }

    /**
     * Encode frequency peaks into Shazam's binary signature format.
     * @param {Map<number, Array>} frequencyBandToPeaks - Peaks grouped by frequency band (0-3).
     * @param {number} numSamples - Total number of PCM samples in the slice.
     * @returns {Buffer} Binary signature buffer with header, CRC32, and peak data.
     */
    static encode(frequencyBandToPeaks, numSamples) {
        const parts = [];

        const header = Buffer.alloc(48);
        let off = 0;
        header.writeUInt32LE(0xcafe2580, off);
        off += 4;
        header.writeUInt32LE(0, off);
        off += 4;
        header.writeUInt32LE(0, off);
        off += 4;
        header.writeUInt32LE(0x94119c00, off);
        off += 4;
        header.writeUInt32LE(0, off);
        off += 4;
        header.writeUInt32LE(0, off);
        off += 4;
        header.writeUInt32LE(0, off);
        off += 4;
        header.writeUInt32LE(3 << 27, off);
        off += 4;
        header.writeUInt32LE(0, off);
        off += 4;
        header.writeUInt32LE(0, off);
        off += 4;
        header.writeUInt32LE(
            numSamples + Math.floor(SignatureGenerator.sampleRate * 0.24),
            off,
        );
        off += 4;
        header.writeUInt32LE((15 << 19) + 0x40000, off);
        off += 4;
        parts.push(header);

        const contentHeader = Buffer.alloc(8);
        contentHeader.writeUInt32LE(0x40000000, 0);
        contentHeader.writeUInt32LE(0, 4);
        parts.push(contentHeader);

        const sortedBands = [...frequencyBandToPeaks.entries()].sort(
            (a, b) => a[0] - b[0],
        );

        for (const [band, peaks] of sortedBands) {
            const peakParts = [];
            let fftPassNumber = 0;

            for (const peak of peaks) {
                if (peak.fftPassNumber - fftPassNumber >= 255) {
                    const escapeBuf = Buffer.alloc(5);
                    escapeBuf.writeUInt8(0xff, 0);
                    escapeBuf.writeUInt32LE(peak.fftPassNumber, 1);
                    peakParts.push(escapeBuf);
                    fftPassNumber = peak.fftPassNumber;
                }

                const peakBuf = Buffer.alloc(5);
                peakBuf.writeUInt8(peak.fftPassNumber - fftPassNumber, 0);
                peakBuf.writeUInt16LE(peak.peakMagnitude, 1);
                peakBuf.writeUInt16LE(peak.correctedPeakFrequencyBin, 3);
                peakParts.push(peakBuf);

                fftPassNumber = peak.fftPassNumber;
            }

            const peaksBuffer = Buffer.concat(peakParts);

            const bandHeader = Buffer.alloc(8);
            bandHeader.writeUInt32LE(0x60030040 + band, 0);
            bandHeader.writeUInt32LE(peaksBuffer.length, 4);
            parts.push(bandHeader);
            parts.push(peaksBuffer);

            const padding = (4 - (peaksBuffer.length % 4)) % 4;
            if (padding > 0) {
                parts.push(Buffer.alloc(padding));
            }
        }

        const fullBuffer = Buffer.concat(parts);
        fullBuffer.writeUInt32LE(fullBuffer.length - 48, 8);
        fullBuffer.writeUInt32LE(fullBuffer.length - 48, 52);
        fullBuffer.writeUInt32LE(SignatureGenerator.crc32(fullBuffer, 8), 4);

        return fullBuffer;
    }

    /**
     * Generate Shazam-compatible audio signatures from PCM samples.
     * Splits audio into 12-second slices and produces a signature per slice.
     * @param {Int16Array} samples - Full audio as s16le mono 16kHz samples.
     * @returns {Array<{uri: string, samplems: number}>} Base64-encoded signature URIs with duration.
     */
    static generate(samples) {
        const sliceSize = SignatureGenerator.sampleRate * 12;
        const numSlices = Math.max(1, Math.ceil(samples.length / sliceSize));
        const signatures = [];

        for (let i = 0; i < numSlices; i++) {
            const start = i * sliceSize;
            const end = Math.min(start + sliceSize, samples.length);
            const slice =
                numSlices === 1 ? samples : samples.subarray(start, end);

            const peaks = SignatureGenerator.fromSamples(slice);
            if (peaks.size === 0) {
                continue;
            }

            const binary = SignatureGenerator.encode(peaks, slice.length);
            signatures.push({
                uri: `data:audio/vnd.shazam.sig;base64,${binary.toString("base64")}`,
                samplems: Math.floor(
                    (slice.length / SignatureGenerator.sampleRate) * 1000,
                ),
            });
        }

        return signatures;
    }
}

/**
 * Shazam client for music recognition and search.
 * Uses audio fingerprinting to identify songs via the Shazam API.
 */
class Shazam {
    /** @type {string[]} Rotating user agent strings for API requests. */
    userAgents = [
        "Shazam/3612 CFNetwork/1335.0.3.4 Darwin/21.6.0",
        "Shazam/3612 CFNetwork/1390 Darwin/22.0.0",
        "Shazam/3612 CFNetwork/1404.0.5 Darwin/22.3.0",
        "Shazam/3612 CFNetwork/1474 Darwin/23.0.0",
    ];

    /** @type {string} Timezone sent with API requests. */
    timezone = "Europe/Paris";

    /**
     * Generate a random UUID v4 string (uppercase).
     * @returns {string}
     */
    uuid() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
            .replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                const v = c === "x" ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            })
            .toUpperCase();
    }

    /**
     * Build HTTP headers for Shazam API requests.
     * @param {string} [language="en"] - Accept-Language value.
     * @returns {Record<string, string>}
     */
    getHeaders(language = "en") {
        return {
            "X-Shazam-Platform": "IPHONE",
            "X-Shazam-AppVersion": "14.1.0",
            Accept: "*/*",
            "Content-Type": "application/json",
            "Accept-Encoding": "identity",
            "Accept-Language": language,
            "User-Agent":
                this.userAgents[
                    Math.floor(Math.random() * this.userAgents.length)
                ],
        };
    }

    /**
     * Build the Shazam discovery API endpoint URL.
     * @param {string} [language="en"] - Language/locale code.
     * @returns {string}
     */
    getUrl(language = "en") {
        const base = `https://amp.shazam.com/discovery/v5/${language}/US/iphone/-/tag/${this.uuid()}/${this.uuid()}`;
        const params = new URLSearchParams({
            sync: "true",
            webv3: "true",
            sampling: "true",
            connected: "",
            shazamapiversion: "v3",
            sharehub: "true",
            hubv5minorversion: "v5.1",
            hidelb: "true",
            video: "v3",
        });
        return `${base}?${params}`;
    }

    /**
     * Detect audio format from magic bytes in the buffer header.
     * @param {Buffer} buffer - Audio file buffer.
     * @returns {"wav"|"ogg"|"flac"|"mp3"}
     */
    detectFormat(buffer) {
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46) {
            return "wav";
        }
        if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67) {
            return "ogg";
        }
        if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61) {
            return "flac";
        }
        return "mp3";
    }

    /**
     * Recognize a song from audio buffer or file path.
     * @param {Buffer|string} input - Audio buffer or file path.
     * @param {object} [options]
     * @param {string} [options.language="en"] - Language code.
     * @param {boolean} [options.minimal=false] - Return minimal info only.
     * @returns {Promise<object|null>} Recognition result or null if not found.
     */
    async recognize(input, options = {}) {
        const { language = "en", minimal = false } = options;

        let buffer;
        if (Buffer.isBuffer(input)) {
            buffer = input;
        } else if (typeof input === "string") {
            buffer = fs.readFileSync(input);
        } else {
            throw new Error("Input must be a Buffer or file path string");
        }

        const ext = this.detectFormat(buffer);
        const rawPCM = await decodeToRawPCM(buffer, ext);

        if (rawPCM.length < SignatureGenerator.sampleRate * 2 * 3) {
            throw new Error(
                "Audio too short. Need at least 3 seconds for recognition.",
            );
        }

        const samples = new Int16Array(
            rawPCM.buffer,
            rawPCM.byteOffset,
            rawPCM.length / 2,
        );
        const signatures = SignatureGenerator.generate(samples);

        if (!signatures.length) {
            throw new Error(
                "No audio signatures generated. Audio may be too short or silent.",
            );
        }

        const response = await this.queryApi(signatures, language);

        if (!response?.matches?.length) {
            return null;
        }
        return minimal ? this.parseMinimal(response) : this.parseFull(response);
    }

    /**
     * Send signatures to Shazam API and return the first successful match response.
     * Tries multiple signature offsets for better hit rate.
     * @param {Array<{uri: string, samplems: number}>} signatures - Generated audio signatures.
     * @param {string} language - Language code for the request.
     * @returns {Promise<object|null>} Raw API response or null.
     */
    async queryApi(signatures, language) {
        let response = null;

        const starts = [
            Math.floor(signatures.length / 4),
            Math.floor(signatures.length / 2),
            Math.floor((signatures.length * 3) / 4),
            0,
        ];

        for (const start of starts) {
            if (response?.matches?.length > 0) {
                break;
            }

            for (let i = start; i < signatures.length; i += 3) {
                const body = JSON.stringify({
                    timezone: this.timezone,
                    signature: {
                        uri: signatures[i].uri,
                        samplems: signatures[i].samplems,
                    },
                    timestamp: Date.now(),
                    context: {},
                    geolocation: {},
                });

                try {
                    const res = await fetch(this.getUrl(language), {
                        method: "POST",
                        headers: this.getHeaders(language),
                        body,
                    });

                    if (!res.ok) {
                        continue;
                    }

                    const text = await res.text();
                    try {
                        response = JSON.parse(text);
                    } catch {
                        continue;
                    }

                    if (response?.matches?.length > 0) {
                        break;
                    }
                } catch {}
            }
        }

        return response;
    }

    /**
     * Parse full track details from Shazam API response.
     * @param {object} response - Raw Shazam API response.
     * @returns {object|null} Parsed track info (title, artist, album, links, etc.) or null.
     */
    parseFull(response) {
        const track = response.track;
        if (!track) {
            return null;
        }

        const songSection = track.sections?.find((s) => s.type === "SONG");
        const metadata = songSection?.metadata || [];

        return {
            title: track.title || "",
            artist: track.subtitle || "",
            album: metadata.find((m) => m.title === "Album")?.text || "",
            year: metadata.find((m) => m.title === "Released")?.text || "",
            label: metadata.find((m) => m.title === "Label")?.text || "",
            genre: track.genres?.primary || "",
            coverArt: track.images?.coverart || track.images?.background || "",
            coverArtHQ: track.images?.coverarthq || "",
            shazamUrl: track.url || "",
            apple: track.hub?.actions?.find((a) => a.type === "uri")?.uri || "",
            spotify:
                track.hub?.providers?.find((p) => p.type === "SPOTIFY")
                    ?.actions?.[0]?.uri || "",
            lyrics:
                track.sections?.find((s) => s.type === "LYRICS")?.text || null,
            key: track.key || "",
            isrc: track.isrc || "",
        };
    }

    /**
     * Parse minimal track info from Shazam API response.
     * @param {object} response - Raw Shazam API response.
     * @returns {{title: string, artist: string, album: string, year: string}|null}
     */
    parseMinimal(response) {
        const track = response.track;
        if (!track) {
            return null;
        }

        const songSection = track.sections?.find((s) => s.type === "SONG");
        const metadata = songSection?.metadata || [];

        return {
            title: track.title || "",
            artist: track.subtitle || "",
            album: metadata.find((m) => m.title === "Album")?.text || "",
            year: metadata.find((m) => m.title === "Released")?.text || "",
        };
    }

    /**
     * Search music on Shazam (via Apple Music catalog).
     * @param {string} query - Search query.
     * @param {object} [options]
     * @param {string} [options.country="US"] - Country code.
     * @param {number} [options.limit=5] - Max results.
     * @returns {Promise<object[]>}
     */
    async search(query, options = {}) {
        const { country = "US", limit = 5 } = options;
        const url = `https://www.shazam.com/services/amapi/v1/catalog/${country}/search?term=${encodeURIComponent(query)}&limit=${limit}&types=songs`;

        const res = await fetch(url, { headers: this.getHeaders() });
        const data = await res.json();
        const songs = data?.results?.songs?.data || [];

        return songs.map((s) => ({
            id: s.id,
            title: s.attributes?.name || "",
            artist: s.attributes?.artistName || "",
            album: s.attributes?.albumName || "",
            genre: s.attributes?.genreNames?.[0] || "",
            duration: s.attributes?.durationInMillis || 0,
            artwork:
                s.attributes?.artwork?.url?.replace("{w}x{h}", "500x500") || "",
            preview: s.attributes?.previews?.[0]?.url || "",
        }));
    }
}

export default new Shazam();
