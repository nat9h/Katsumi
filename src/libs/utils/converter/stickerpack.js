/**
 * Native StickerPackMessage builder.
 * Converts media → WebP, zips them (uncompressed), encrypts + uploads,
 * then returns a ready-to-relay StickerPackMessage proto.
 */

import {
    createCipheriv,
    createHash,
    createHmac,
    randomBytes,
} from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMediaKeys, proto } from "baileys";
import sharp from "sharp";

const sha256 = (buf) => createHash("sha256").update(buf).digest();
const genId = () => randomBytes(16).toString("hex").toUpperCase();

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[n] = c;
}

function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
}

function buildZip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const [name, content] of Object.entries(files)) {
        const nameBuf = Buffer.from(name, "utf8");
        const crc = crc32(content);
        const size = content.length;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); // local file header sig
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(size, 18); // compressed
        local.writeUInt32LE(size, 22); // uncompressed
        local.writeUInt16LE(nameBuf.length, 26);
        locals.push(local, nameBuf, content);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); // central dir sig
        central.writeUInt16LE(20, 4); // version made by
        central.writeUInt16LE(20, 6); // version needed
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(size, 20);
        central.writeUInt32LE(size, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42); // relative offset
        centrals.push(central, nameBuf);

        offset += 30 + nameBuf.length + size;
    }

    const centralBuf = Buffer.concat(centrals);
    const count = Object.keys(files).length;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(count, 8);
    eocd.writeUInt16LE(count, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...locals, centralBuf, eocd]);
}

function isWebP(buf) {
    return (
        buf.length >= 12 &&
        buf.toString("ascii", 0, 4) === "RIFF" &&
        buf.toString("ascii", 8, 12) === "WEBP"
    );
}

function isAnimatedWebP(buf) {
    if (!isWebP(buf)) {
        return false;
    }
    let off = 12;
    while (off < buf.length - 8) {
        const tag = buf.toString("ascii", off, off + 4);
        const size = buf.readUInt32LE(off + 4);
        if (tag === "VP8X" && off + 8 < buf.length && buf[off + 8] & 0x02) {
            return true;
        }
        if (tag === "ANIM" || tag === "ANMF") {
            return true;
        }
        off += 8 + size + (size % 2);
    }
    return false;
}

async function toWebP(buf) {
    if (isWebP(buf)) {
        return { webp: buf, animated: isAnimatedWebP(buf) };
    }

    try {
        const webp = await sharp(buf).webp().toBuffer();
        return { webp, animated: false };
    } catch {
        const { createSticker } = await import("#libs/utils/converter/sticker");
        const webp = await createSticker(buf, false, {});
        return { webp, animated: isAnimatedWebP(webp) };
    }
}

async function encryptMedia(plain, mediaType, reuseKey) {
    const mediaKey = reuseKey || randomBytes(32);
    const { cipherKey, iv, macKey } = await getMediaKeys(mediaKey, mediaType);

    const cipher = createCipheriv("aes-256-cbc", cipherKey, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);

    const hmac = createHmac("sha256", macKey);
    hmac.update(iv);
    hmac.update(encrypted);
    const mac = hmac.digest().subarray(0, 10);

    const encBuf = Buffer.concat([encrypted, mac]);

    return {
        encBuf,
        mediaKey,
        fileSha256: sha256(plain),
        fileEncSha256: sha256(encBuf),
        fileLength: plain.length,
    };
}

async function uploadEncrypted(sock, encBuf, fileEncSha256, mediaType) {
    const tmp = join(
        tmpdir(),
        `spack_${Date.now()}_${Math.random().toString(36).slice(2)}.enc`,
    );
    await writeFile(tmp, encBuf);
    try {
        return await sock.waUploadToServer(tmp, {
            fileEncSha256B64: fileEncSha256.toString("base64"),
            mediaType,
            timeoutMs: 60_000,
        });
    } finally {
        unlink(tmp).catch(() => {});
    }
}

export async function buildStickerPackMessage(opts, sock) {
    const { stickers, cover, name, publisher, description, packId } = opts;

    if (!stickers?.length) {
        throw new Error("Pack harus punya minimal 1 sticker");
    }
    if (stickers.length > 60) {
        throw new Error("Maksimal 60 sticker per pack");
    }

    const id = packId || genId();
    const zipData = {};

    const meta = await Promise.all(
        stickers.map(async (s, i) => {
            const { webp, animated } = await toWebP(s.data);
            if (webp.length > 1024 * 1024) {
                throw new Error(
                    `Sticker #${i + 1} kegedean (${(webp.length / 1024) | 0}KB, max 1MB)`,
                );
            }

            const hash = sha256(webp).toString("base64").replace(/\//g, "-");
            const fileName = `${hash}.webp`;
            zipData[fileName] = webp;

            return {
                fileName,
                mimetype: "image/webp",
                isAnimated: animated,
                emojis: s.emojis || [],
                accessibilityLabel: s.accessibilityLabel || "",
            };
        }),
    );

    const trayFile = `${id}.webp`;
    const { webp: coverWebp } = await toWebP(cover);
    zipData[trayFile] = coverWebp;

    const zip = buildZip(zipData);

    const pack = await encryptMedia(zip, "sticker-pack");
    const packUpload = await uploadEncrypted(
        sock,
        pack.encBuf,
        pack.fileEncSha256,
        "sticker-pack",
    );

    const thumbBuf = await sharp(coverWebp).resize(252, 252).jpeg().toBuffer();
    const thumb = await encryptMedia(
        thumbBuf,
        "thumbnail-sticker-pack",
        pack.mediaKey,
    );
    const thumbUpload = await uploadEncrypted(
        sock,
        thumb.encBuf,
        thumb.fileEncSha256,
        "thumbnail-sticker-pack",
    );

    return {
        stickerPackMessage: {
            name,
            publisher,
            stickerPackId: id,
            packDescription: description || "",
            stickerPackOrigin:
                proto.Message.StickerPackMessage.StickerPackOrigin.USER_CREATED,
            stickerPackSize: zip.length,
            stickers: meta,
            fileSha256: pack.fileSha256,
            fileEncSha256: pack.fileEncSha256,
            mediaKey: pack.mediaKey,
            directPath: packUpload.directPath,
            fileLength: pack.fileLength,
            mediaKeyTimestamp: Math.floor(Date.now() / 1000),
            trayIconFileName: trayFile,
            thumbnailDirectPath: thumbUpload.directPath,
            thumbnailSha256: thumb.fileSha256,
            thumbnailEncSha256: thumb.fileEncSha256,
            thumbnailHeight: 252,
            thumbnailWidth: 252,
            imageDataHash: sha256(thumbBuf).toString("base64"),
        },
    };
}
