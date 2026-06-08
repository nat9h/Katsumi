/**
 * Patch for baileys — adds sticker-pack media type support.
 * Required for native StickerPackMessage upload.
 *
 * Based on: https://github.com/WhiskeySockets/Baileys/pull/1561
 *
 * Run: node patches/baileys-sticker-pack.js
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const filePath = join(
    process.cwd(),
    "node_modules/baileys/lib/Defaults/index.js",
);

let content = readFileSync(filePath, "utf8");

if (content.includes("sticker-pack")) {
    console.log("Sticker pack patch already applied.");
    process.exit(0);
}

// Patch MEDIA_PATH_MAP
const oldPathMap = `sticker: '/mms/image',
    'thumbnail-link'`;
const newPathMap = `sticker: '/mms/image',
    'sticker-pack': '/mms/sticker-pack',
    'thumbnail-sticker-pack': '/mms/thumbnail-sticker-pack',
    'thumbnail-link'`;

if (!content.includes(oldPathMap)) {
    console.error("Could not find MEDIA_PATH_MAP target. Baileys version may have changed.");
    process.exit(1);
}

content = content.replace(oldPathMap, newPathMap);

// Patch MEDIA_HKDF_KEY_MAPPING
const oldHkdf = `sticker: 'Image',
    video:`;
const newHkdf = `sticker: 'Image',
    'sticker-pack': 'Sticker Pack',
    'thumbnail-sticker-pack': 'Sticker Pack Thumbnail',
    video:`;

if (!content.includes(oldHkdf)) {
    console.error("Could not find MEDIA_HKDF_KEY_MAPPING target. Baileys version may have changed.");
    process.exit(1);
}

content = content.replace(oldHkdf, newHkdf);

writeFileSync(filePath, content, "utf8");
console.log("Patched baileys: sticker-pack media type support added.");
