/**
 * @fileoverview Project Sekai sticker scraper & maker.
 * Fetches sticker data from st.ayaka.one and generates sticker images with custom text.
 * Uses sharp (already installed) for text rendering via SVG overlay.
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

    /**
     * Load sticker data from the frontend bundle.
     * Caches the result for subsequent calls.
     * @returns {Promise<Array<{id: string, name: string, character: string, img: string, color: string, defaultText: {text: string, x: number, y: number, r: number, s: number}}>>}
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
     * @returns {Promise<Array<{id: string, name: string, character: string, img: string, color: string, url: string}>>}
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
     * @returns {Promise<Array<{id: string, name: string, character: string, img: string, color: string, url: string}>>}
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
     * @returns {Promise<{id: string, name: string, character: string, img: string, color: string, url: string, defaultText: object}>}
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
     * Get sticker image as Buffer.
     * @param {string} stickerImg - The img path (e.g. "airi/Airi_01.png")
     * @returns {Promise<Buffer>}
     */
    async getImage(stickerImg) {
        const url = stickerImg.startsWith("http")
            ? stickerImg
            : `${this.#base}/img/${stickerImg}`;
        const { data } = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 15_000,
        });
        return Buffer.from(data);
    }

    /**
     * Get a sticker by ID.
     * @param {string} id - Sticker ID
     * @returns {Promise<{id: string, name: string, character: string, img: string, color: string, url: string, defaultText: object}|null>}
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
     * Generate a sticker with custom text overlay.
     * Renders text on the character image using sharp + SVG.
     * Replicates the original site's style: YurukaStd font, white stroke, colored fill.
     *
     * @param {object} options
     * @param {string} options.character - Character name (case-insensitive)
     * @param {string} options.text - Text to render on the sticker
     * @param {number} [options.index=0] - Sticker index for the character (0-12)
     * @param {number} [options.fontSize] - Font size (default from sticker data)
     * @param {number} [options.rotate] - Text rotation in degrees (default from sticker data)
     * @param {number} [options.x] - Text X position (default from sticker data)
     * @param {number} [options.y] - Text Y position (default from sticker data)
     * @returns {Promise<Buffer>} PNG image buffer
     */
    async make({ character, text, index = 0, fontSize, rotate, x, y }) {
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
        const estimatedWidth = text.length * textS * 0.6;
        if (estimatedWidth > maxTextWidth) {
            textS = Math.floor(maxTextWidth / (text.length * 0.6));
            textS = Math.max(textS, 14);
        }

        const fontFace = await this.#getFontFace();

        const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        const strokeWidth = Math.max(5, Math.round(textS * 0.19));
        const fontFamily =
            "YurukaStd, 'Arial Rounded MT Bold', 'Comic Sans MS', sans-serif";

        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <style>${fontFace}</style>
            </defs>
            <g transform="rotate(${textR}, ${textX}, ${textY})">
                <text x="${textX}" y="${textY}" text-anchor="middle"
                    font-family="${fontFamily}" font-size="${textS}px" font-weight="bold"
                    stroke="white" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"
                    fill="none">${escaped}</text>
                <text x="${textX}" y="${textY}" text-anchor="middle"
                    font-family="${fontFamily}" font-size="${textS}px" font-weight="bold"
                    fill="${color}">${escaped}</text>
            </g>
        </svg>`;

        const result = await sharp(imgBuffer)
            .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
            .png()
            .toBuffer();

        return result;
    }

    /** @type {string|null} */
    #fontFaceCache = null;

    /**
     * Get CSS @font-face rule. Tries local font file (OTF/TTF), falls back to empty.
     * If YurukaStd.otf or .ttf exists in fonts/ dir, it will be loaded.
     */
    async #getFontFace() {
        if (this.#fontFaceCache !== null) {
            return this.#fontFaceCache;
        }

        for (const ext of ["otf", "ttf"]) {
            const fontPath = resolve(_fonts, `YurukaStd.${ext}`);
            if (existsSync(fontPath)) {
                const data = readFileSync(fontPath);
                const base64 = data.toString("base64");
                const mime = ext === "otf" ? "font/otf" : "font/ttf";
                const format = ext === "otf" ? "opentype" : "truetype";
                this.#fontFaceCache = `@font-face { font-family: 'YurukaStd'; src: url('data:${mime};base64,${base64}') format('${format}'); }`;
                return this.#fontFaceCache;
            }
        }

        this.#fontFaceCache = "";
        return this.#fontFaceCache;
    }
}

export default new SekaiSticker();
