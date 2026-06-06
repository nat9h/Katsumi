/**
 * @fileoverview Project Sekai sticker scraper & maker.
 * Fetches sticker data from st.ayaka.one and generates sticker images with custom text.
 * Uses sharp for text rendering via SVG overlay — replicates the original site styling.
 * @module scrapers/sekai-sticker
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _fonts = resolve(__dirname, "fonts");

class SekaiSticker {
    #stickers = null;
    #characters = null;
    #base = "https://st.ayaka.one";
    #fontFaceCache = null;
    #imageCache = new Map();
    #imageCacheMax = 50;

    /**
     * Load sticker data from the frontend bundle.
     * Caches the result for subsequent calls.
     */
    async #loadStickers() {
        if (this.#stickers) {
            return this.#stickers;
        }

        const { data: js } = await axios.get(
            `${this.#base}/static/js/main.32d4ad8f.js`,
            { timeout: 15_000 },
        );
        const match = js.match(/JSON\.parse\s*\(\s*'(\[.*?\])'\s*\)/);
        if (!match) {
            throw new Error("Could not extract sticker data from bundle.");
        }

        this.#stickers = JSON.parse(match[1]);
        this.#characters = [
            ...new Set(this.#stickers.map((s) => s.character.toLowerCase())),
        ];
        return this.#stickers;
    }

    /**
     * Get all available characters.
     * @returns {Promise<string[]>}
     */
    async getCharacters() {
        await this.#loadStickers();
        return this.#characters;
    }

    /**
     * Get all stickers for a specific character.
     * @param {string} character - Character name (case-insensitive)
     * @returns {Promise<Array>}
     */
    async getStickers(character) {
        const stickers = await this.#loadStickers();
        const filtered = stickers.filter(
            (s) => s.character.toLowerCase() === character.toLowerCase(),
        );
        return filtered.map((s) => ({
            ...s,
            url: `${this.#base}/img/${s.img}`,
        }));
    }

    /**
     * Search stickers by name or character.
     * @param {string} query - Search query
     * @returns {Promise<Array>}
     */
    async search(query) {
        const stickers = await this.#loadStickers();
        const q = query.toLowerCase();
        const filtered = stickers.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.character.toLowerCase().includes(q) ||
                s.id === q,
        );
        return filtered.map((s) => ({
            ...s,
            url: `${this.#base}/img/${s.img}`,
        }));
    }

    /**
     * Get a random sticker, optionally filtered by character.
     * @param {string} [character] - Optional character filter
     */
    async random(character) {
        const stickers = await this.#loadStickers();
        let pool = stickers;
        if (character) {
            pool = stickers.filter(
                (s) => s.character.toLowerCase() === character.toLowerCase(),
            );
            if (pool.length === 0) {
                pool = stickers;
            }
        }
        const s = pool[Math.floor(Math.random() * pool.length)];
        return { ...s, url: `${this.#base}/img/${s.img}` };
    }

    /**
     * Get sticker image as Buffer (with LRU cache).
     * @param {string} stickerImg - The img path (e.g. "airi/Airi_01.png")
     * @returns {Promise<Buffer>}
     */
    async getImage(stickerImg) {
        const url = stickerImg.startsWith("http")
            ? stickerImg
            : `${this.#base}/img/${stickerImg}`;

        if (this.#imageCache.has(url)) {
            return this.#imageCache.get(url);
        }

        const { data } = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 15_000,
        });
        const buffer = Buffer.from(data);

        // Simple LRU: evict oldest when cache is full
        if (this.#imageCache.size >= this.#imageCacheMax) {
            const firstKey = this.#imageCache.keys().next().value;
            this.#imageCache.delete(firstKey);
        }
        this.#imageCache.set(url, buffer);

        return buffer;
    }

    /**
     * Get a sticker by ID.
     * @param {string} id - Sticker ID
     */
    async getById(id) {
        const stickers = await this.#loadStickers();
        const s = stickers.find((st) => st.id === String(id));
        if (!s) {
            return null;
        }
        return { ...s, url: `${this.#base}/img/${s.img}` };
    }

    /**
     * Get all stickers grouped by character.
     * @returns {Promise<Record<string, Array>>}
     */
    async getAllGrouped() {
        const stickers = await this.#loadStickers();
        const grouped = {};
        for (const s of stickers) {
            const char = s.character.toLowerCase();
            if (!grouped[char]) {
                grouped[char] = [];
            }
            grouped[char].push({ ...s, url: `${this.#base}/img/${s.img}` });
        }
        return grouped;
    }

    /**
     * Estimate character width (CJK-aware).
     * Based on average glyph widths for YurukaStd / rounded sans-serif fonts.
     * Intentionally slightly under-estimates to avoid premature wrapping.
     * @param {string} ch - Single character
     * @param {number} fontSize - Font size in px
     * @returns {number} Estimated pixel width
     */
    #charWidth(ch, fontSize) {
        const code = ch.charCodeAt(0);
        if (
            (code >= 0x3000 && code <= 0x9fff) ||
            (code >= 0xf900 && code <= 0xfaff) ||
            (code >= 0xff00 && code <= 0xffef)
        ) {
            return fontSize * 0.9;
        }
        if ("il1|!.,;:'".includes(ch)) {
            return fontSize * 0.3;
        }
        if ("ftjrI()[]{}".includes(ch)) {
            return fontSize * 0.38;
        }
        if ("mMwWOQD@%".includes(ch)) {
            return fontSize * 0.7;
        }
        if (code >= 0x41 && code <= 0x5a) {
            return fontSize * 0.58;
        }
        return fontSize * 0.5;
    }

    /**
     * Measure estimated width of a string.
     * @param {string} str
     * @param {number} fontSize
     * @returns {number}
     */
    #measureText(str, fontSize) {
        let w = 0;
        for (const ch of str) {
            w += this.#charWidth(ch, fontSize);
        }
        return w;
    }

    /**
     * Wrap text into multiple lines with word-aware breaking.
     * Prefers breaking on spaces/hyphens, falls back to character wrap for long words.
     * @param {string} text - Input text
     * @param {number} maxWidth - Maximum pixel width per line
     * @param {number} fontSize - Current font size
     * @returns {string[]} Array of text lines
     */
    #wrapText(text, maxWidth, fontSize) {
        const tokens = text.match(/[\S]+|\s+/g) || [text];
        const lines = [];
        let currentLine = "";
        let currentWidth = 0;

        for (const token of tokens) {
            const tokenWidth = this.#measureText(token, fontSize);
            if (tokenWidth > maxWidth && token.trim().length > 0) {
                if (currentLine.trim()) {
                    lines.push(currentLine.trim());
                    currentLine = "";
                    currentWidth = 0;
                }
                let chunk = "";
                let chunkW = 0;
                for (const ch of token) {
                    const cw = this.#charWidth(ch, fontSize);
                    if (chunkW + cw > maxWidth && chunk.length > 0) {
                        lines.push(chunk);
                        chunk = ch;
                        chunkW = cw;
                    } else {
                        chunk += ch;
                        chunkW += cw;
                    }
                }
                if (chunk) {
                    currentLine = chunk;
                    currentWidth = chunkW;
                }
                continue;
            }

            if (currentWidth + tokenWidth > maxWidth && currentLine.trim()) {
                lines.push(currentLine.trim());
                currentLine = token.trimStart();
                currentWidth = this.#measureText(currentLine, fontSize);
            } else {
                currentLine += token;
                currentWidth += tokenWidth;
            }
        }

        if (currentLine.trim()) {
            lines.push(currentLine.trim());
        }

        return lines.length > 0 ? lines : [text];
    }

    /**
     * Escape text for safe SVG embedding.
     * @param {string} str
     * @returns {string}
     */
    #escapeSvg(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    /**
     * Generate a sticker with custom text overlay.
     * Renders text on the character image using sharp + SVG.
     * Styling: YurukaStd font, thick white stroke, colored fill, drop shadow.
     *
     * @param {object} options
     * @param {string} options.character - Character name (case-insensitive)
     * @param {string} options.text - Text to render on the sticker
     * @param {number} [options.index=0] - Sticker index for the character (0-based)
     * @param {number} [options.fontSize] - Font size override
     * @param {number} [options.rotate] - Text rotation in degrees
     * @param {number} [options.x] - Text X position override
     * @param {number} [options.y] - Text Y position override
     * @param {"normal"|"italic"} [options.style="normal"] - Font style
     * @returns {Promise<Buffer>} PNG image buffer
     */
    async make({
        character,
        text,
        index = 0,
        fontSize,
        rotate,
        x,
        y,
        style = "normal",
    }) {
        if (!text?.trim()) {
            throw new Error("Text is required.");
        }
        if (!character?.trim()) {
            throw new Error("Character is required.");
        }

        const stickers = await this.getStickers(character);
        if (stickers.length === 0) {
            throw new Error(
                `Character "${character}" not found. Available: ${(await this.getCharacters()).join(", ")}`,
            );
        }

        const idx = Math.min(Math.max(0, index), stickers.length - 1);
        const sticker = stickers[idx];
        const dt = sticker.defaultText || { x: 148, y: 58, r: 0, s: 40 };

        const textX = x ?? dt.x;
        const textY = y ?? dt.y;
        const textR = rotate ?? dt.r;
        let textS = fontSize ?? dt.s;
        const color = sticker.color || "#FFFFFF";

        const imgBuffer = await this.getImage(sticker.img);
        const meta = await sharp(imgBuffer).metadata();
        const width = meta.width || 296;
        const height = meta.height || 256;

        const maxTextWidth = width * 0.9;
        const maxLines = 4;
        const minFontSize = 16;

        const isSingleWord = !text.includes(" ");
        if (isSingleWord) {
            const wordWidth = this.#measureText(text, textS);
            if (wordWidth > maxTextWidth) {
                textS = Math.max(
                    minFontSize,
                    Math.floor(textS * (maxTextWidth / wordWidth)),
                );
            }
        }

        let lines = this.#wrapText(text, maxTextWidth, textS);

        let attempts = 0;
        while (lines.length > maxLines && textS > minFontSize && attempts < 5) {
            const ratio = Math.max(0.7, maxLines / lines.length);
            textS = Math.max(minFontSize, Math.floor(textS * ratio));
            lines = this.#wrapText(text, maxTextWidth, textS);
            attempts++;
        }

        if (lines.length > maxLines) {
            lines = lines.slice(0, maxLines);
            const last = lines[maxLines - 1];
            lines[maxLines - 1] =
                last.length > 3 ? `${last.slice(0, -3)}...` : `${last}...`;
        }

        const fontFace = await this.#getFontFace();
        const strokeWidth = Math.max(5, Math.round(textS * 0.2));
        const shadowOffset = Math.max(2, Math.round(textS * 0.06));
        const fontFamily =
            "YurukaStd, 'Arial Rounded MT Bold', 'Rounded Mplus 1c', 'Comic Sans MS', sans-serif";
        const lineHeight = textS * 1.3;
        const fontStyle = style === "italic" ? "italic" : "normal";

        const totalTextHeight = (lines.length - 1) * lineHeight;
        const startY = textY - totalTextHeight / 2;

        const tspans = lines
            .map((line, i) => {
                const escaped = this.#escapeSvg(line);
                const ly = Math.round(startY + i * lineHeight);
                return `<tspan x="${textX}" y="${ly}">${escaped}</tspan>`;
            })
            .join("\n                    ");

        const filterId = "sekaiShadow";
        const filterDef = `
                <filter id="${filterId}" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="${shadowOffset}" dy="${shadowOffset}" stdDeviation="1.5" flood-color="rgba(0,0,0,0.3)" />
                </filter>`;

        const textAttrs = `text-anchor="middle" font-family="${fontFamily}" font-size="${textS}px" font-weight="bold" font-style="${fontStyle}"`;

        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <style>${fontFace}</style>
                ${filterDef}
            </defs>
            <g transform="rotate(${textR}, ${textX}, ${textY})" filter="url(#${filterId})">
                <text ${textAttrs}
                    stroke="white" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"
                    fill="white" paint-order="stroke">
                    ${tspans}
                </text>
                <text ${textAttrs}
                    fill="${color}">
                    ${tspans}
                </text>
            </g>
        </svg>`;

        const result = await sharp(imgBuffer)
            .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
            .png()
            .toBuffer();

        return result;
    }

    /**
     * Get CSS @font-face rule. Loads local YurukaStd font if available.
     * @returns {Promise<string>}
     */
    async #getFontFace() {
        if (this.#fontFaceCache !== null) {
            return this.#fontFaceCache;
        }

        for (const ext of ["otf", "ttf", "woff2", "woff"]) {
            const fontPath = resolve(_fonts, `YurukaStd.${ext}`);
            if (existsSync(fontPath)) {
                const data = readFileSync(fontPath);
                const base64 = data.toString("base64");
                const mimeMap = {
                    otf: "font/otf",
                    ttf: "font/ttf",
                    woff2: "font/woff2",
                    woff: "font/woff",
                };
                const formatMap = {
                    otf: "opentype",
                    ttf: "truetype",
                    woff2: "woff2",
                    woff: "woff",
                };
                this.#fontFaceCache = `@font-face { font-family: 'YurukaStd'; font-weight: bold; src: url('data:${mimeMap[ext]};base64,${base64}') format('${formatMap[ext]}'); }`;
                return this.#fontFaceCache;
            }
        }

        this.#fontFaceCache = "";
        return this.#fontFaceCache;
    }
}

export default new SekaiSticker();
