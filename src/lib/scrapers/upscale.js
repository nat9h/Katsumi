export class Upscaler {
	static BASE_URL = "https://get1.imglarger.com/api/UpscalerNew";
	static UPLOAD_ENDPOINT = "/UploadNew";
	static STATUS_ENDPOINT = "/CheckStatusNew";

	static headers = {
		accept: "application/json, text/plain, */*",
		"accept-language": "en-US,en;q=0.9",
		origin: "https://imgupscaler.com",
		referer: "https://imgupscaler.com/",
		"user-agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
	};

	constructor({
		scaleRadio = 2,
		pollIntervalMs = 3000,
		timeoutMs = 120000,
		debug = true,
	} = {}) {
		this.scaleRadio = scaleRadio;
		this.pollIntervalMs = pollIntervalMs;
		this.timeoutMs = timeoutMs;
		this.debug = debug;
	}

	log(...args) {
		if (this.debug) {
			console.log("[Upscaler]", ...args);
		}
	}

	sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async #safeJson(response) {
		const text = await response.text();
		try {
			return JSON.parse(text);
		} catch {
			throw new Error(
				`Response is not valid JSON. Status=${response.status}, Body=${text.slice(0, 500)}`
			);
		}
	}

	async #downloadImage(url) {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(
				`Failed to download source image: ${response.status} ${response.statusText}`
			);
		}

		const contentType =
			response.headers.get("content-type") || "image/jpeg";
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		return { buffer, contentType };
	}

	async #uploadImage(image, contentType, scaleRadio) {
		const formData = new FormData();

		const file = new File([image], "image.jpg", {
			type: contentType || "image/jpeg",
		});

		formData.append("myfile", file);
		formData.append("scaleRadio", String(scaleRadio));

		const response = await fetch(
			`${Upscaler.BASE_URL}${Upscaler.UPLOAD_ENDPOINT}`,
			{
				method: "POST",
				headers: {
					...Upscaler.headers,
				},
				body: formData,
			}
		);

		const result = await this.#safeJson(response);
		this.log("UPLOAD RESPONSE:", result);

		if (!response.ok) {
			throw new Error(
				`Upload failed: HTTP ${response.status} - ${result?.msg || response.statusText}`
			);
		}

		if (result.code !== 200 || !result?.data?.code) {
			throw new Error(`Upload error: ${JSON.stringify(result)}`);
		}

		return result.data.code;
	}

	async #checkStatus(code, scaleRadio) {
		const response = await fetch(
			`${Upscaler.BASE_URL}${Upscaler.STATUS_ENDPOINT}`,
			{
				method: "POST",
				headers: {
					...Upscaler.headers,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					code,
					scaleRadio,
				}),
			}
		);

		const result = await this.#safeJson(response);
		this.log("STATUS RESPONSE:", result);

		if (!response.ok) {
			throw new Error(
				`Status check failed: HTTP ${response.status} - ${result?.msg || response.statusText}`
			);
		}

		if (result.code !== 200) {
			throw new Error(`Status API error: ${JSON.stringify(result)}`);
		}

		return result;
	}

	async #pollStatus(code, scaleRadio) {
		const start = Date.now();

		while (Date.now() - start < this.timeoutMs) {
			const result = await this.#checkStatus(code, scaleRadio);
			const data = result.data || {};
			const status = data.status;
			const downloadUrls = data.downloadUrls || [];

			if (status === "success") {
				if (!downloadUrls.length || !downloadUrls[0]) {
					throw new Error(
						"Status is success but download URL is empty"
					);
				}
				return downloadUrls[0];
			}

			if (status === "failed" || status === "error") {
				throw new Error(
					`Upscale process failed. Response: ${JSON.stringify(result)}`
				);
			}

			this.log(
				`Still ${status || "unknown"}... waiting ${this.pollIntervalMs}ms`
			);
			await this.sleep(this.pollIntervalMs);
		}

		throw new Error(`Timeout after ${this.timeoutMs} ms`);
	}

	async #downloadResult(url) {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(
				`Failed to download upscaled result: ${response.status} ${response.statusText}`
			);
		}

		return Buffer.from(await response.arrayBuffer());
	}

	async upscaleFromUrl(url, scaleRadio = this.scaleRadio) {
		const { buffer, contentType } = await this.#downloadImage(url);

		this.log("Source downloaded:", {
			size: buffer.length,
			contentType,
			scaleRadio,
		});

		const code = await this.#uploadImage(buffer, contentType, scaleRadio);
		this.log("Upload code:", code);

		const resultUrl = await this.#pollStatus(code, scaleRadio);
		this.log("Result URL:", resultUrl);

		const resultBuffer = await this.#downloadResult(resultUrl);
		this.log("Result downloaded:", resultBuffer.length, "bytes");

		return {
			code,
			resultUrl,
			buffer: resultBuffer,
		};
	}
}

// example usage
// const upscaler = new Upscaler({
// 	scaleRadio: 2, // max 4
// 	pollIntervalMs: 3000,
// 	timeoutMs: 120000,
// 	debug: false,
// });

// const url =
// 	"https://i.pinimg.com/1200x/d4/50/83/d450838effd54ae18f35c1e744bc6db3.jpg";

// try {
// 	const result = await upscaler.upscaleFromUrl(url);
// 	console.log("Code:", result.code);
// 	console.log("Result URL:", result.resultUrl);
// } catch (err) {
// 	console.error("Error:", err);
// }
