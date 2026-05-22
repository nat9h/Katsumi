/**
 * @fileoverview AI outpainting scraper via Pixelcut (no API key needed).
 * @module scrapers/outpainting
 */

export class Outpainting {
    constructor(opts = {}) {
        this.uploadUrl = "https://api2.pixelcut.app/image/upload/v1";
        this.outpaintUrl =
            "https://api2.pixelcut.app/image_service.v1.ImageService/Outpaint";
        this.userAgent =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.6925.96 Safari/537.36";
        this.clientVersion = "web:pixa.com:150ce85a";
        Object.assign(this, opts);
    }

    _buildPayload(uploadId) {
        const idBuf = Buffer.from(uploadId, "utf-8");
        const proto = Buffer.concat([
            Buffer.from([0x0a, idBuf.length]),
            idBuf,
            Buffer.from([0x20, 0x9e, 0x02, 0x28, 0x9e, 0x02]),
        ]);
        const frame = Buffer.alloc(5);
        frame.writeUInt8(0, 0);
        frame.writeUInt32BE(proto.length, 1);
        return Buffer.concat([frame, proto]);
    }

    async process(imageUrl) {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
            throw new Error(`Failed to fetch image: ${imgRes.statusText}`);
        }
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());

        const form = new FormData();
        form.append(
            "image",
            new Blob([imgBuf], { type: "image/jpeg" }),
            "image.jpg",
        );
        const uploadRes = await fetch(this.uploadUrl, {
            method: "POST",
            headers: {
                "x-client-version": this.clientVersion,
                "user-agent": this.userAgent,
            },
            body: form,
        });
        const { upload_id } = await uploadRes.json();
        if (!upload_id) {
            throw new Error("No upload_id in response.");
        }

        const payload = this._buildPayload(upload_id);
        const outpaintRes = await fetch(this.outpaintUrl, {
            method: "POST",
            headers: {
                "content-type": "application/grpc-web+proto",
                "x-grpc-web": "1",
                "x-client-version": this.clientVersion,
                "user-agent": "connect-es/2.1.1",
                origin: "https://www.pixa.com",
                referer: "https://www.pixa.com/",
            },
            body: payload,
        });
        const raw = Buffer.from(await outpaintRes.arrayBuffer()).toString(
            "utf-8",
        );

        const urlPattern =
            // biome-ignore lint/suspicious/noControlCharactersInRegex: need to filter binary gRPC
            /https:\/\/assets\.pixelcut\.app\/temp\/outpaint\/[^\s"'\x00-\x1F\x7F]+/;
        const match = raw.match(urlPattern);
        if (!match) {
            throw new Error("Result URL not found in response.");
        }
        const resultUrl = match[0].replace(
            /[^a-zA-Z0-9.\-_~:/?#[\]@!$&'()*+,;=%]+$/,
            "",
        );

        const finalRes = await fetch(resultUrl);
        const resBuf = Buffer.from(await finalRes.arrayBuffer());

        return { url: resultUrl, buffer: resBuf };
    }
}

export default Outpainting;
