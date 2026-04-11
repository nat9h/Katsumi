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
		console.log("[1/4] Fetching image...");
		const _imgres = await fetch(imageUrl);
		if (!_imgres.ok) {
			throw new Error(`Failed to fetch image: ${_imgres.statusText}`);
		}
		const imgBuf = Buffer.from(await _imgres.arrayBuffer());

		console.log("[2/4] Uploading to Pixelcut...");
		const form = new FormData();
		form.append(
			"image",
			new Blob([imgBuf], { type: "image/jpeg" }),
			"image.jpg"
		);
		const _uploadres = await fetch(this.uploadUrl, {
			method: "POST",
			headers: {
				"x-client-version": this.clientVersion,
				"user-agent": this.userAgent,
			},
			body: form,
		});
		const { upload_id } = await _uploadres.json();
		if (!upload_id) {
			throw new Error("No upload_id in response");
		}

		console.log("[3/4] Requesting outpaint...");
		const payload = this._buildPayload(upload_id);
		const outpaint_res = await fetch(this.outpaintUrl, {
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
		const raw = Buffer.from(await outpaint_res.arrayBuffer()).toString(
			"utf-8"
		);

		const match = raw.match(
			/https:\/\/assets\.pixelcut\.app\/temp\/outpaint\/[^\s"'\u0000-\u001F\u007F]+/
		);
		if (!match) {
			throw new Error("Result URL not found in response");
		}
		const _res = match[0].replace(
			/[^a-zA-Z0-9.\-_~:/?#[\]@!$&'()*+,;=%]+$/,
			""
		);

		console.log("[4/4] Downloading result...");
		const final_res = await fetch(_res);
		const resBuf = Buffer.from(await final_res.arrayBuffer());

		return { url: _res, buffer: resBuf };
	}
}

// Example usage (remove when importing):
// const outpainter = new Outpainting();
// outpainter
// 	.process(
// 		"https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600"
// 	)
// 	.then((res) => console.log("Done!", res.url, res.buffer.length))
// 	.catch((err) => console.error("Error:", err.message));
