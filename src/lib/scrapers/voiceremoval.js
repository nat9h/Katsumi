export class VocalRemover {
	constructor() {
		this.baseUrl = "https://aivocalremover.com";
		this.sessionId = null;
		this.key = null;
	}

	async init() {
		const res = await fetch(`${this.baseUrl}/`, {
			headers: {
				"User-Agent": "Mozilla/5.0",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
		});

		const html = await res.text();
		const cookies = res.headers.get("set-cookie");

		this.sessionId = cookies.match(/JSESSIONID=([^;]+)/)?.[1];
		this.key = html.match(/key:\s*"([^"]+)"/)?.[1];

		if (!this.sessionId || !this.key) {
			throw new Error("Failed to initialize session.");
		}
	}

	async uploadFile(url) {
		const fileRes = await fetch(url);
		const buffer = await fileRes.arrayBuffer();
		const fileName = url.split("/").pop() || "audio.mp3";

		const form = new FormData();
		form.append(
			"fileName",
			new Blob([buffer], { type: "audio/mpeg" }),
			fileName
		);

		const res = await fetch(`${this.baseUrl}/api/v2/FileUpload`, {
			method: "POST",
			headers: {
				Cookie: `JSESSIONID=${this.sessionId}`,
				Origin: this.baseUrl,
				Referer: `${this.baseUrl}/`,
				"X-Requested-With": "XMLHttpRequest",
			},
			body: form,
		});

		const data = await res.json();
		if (data.error) {
			throw new Error(data.message);
		}

		return data.file_name;
	}

	async processFile(fileName) {
		const res = await fetch(`${this.baseUrl}/api/v2/ProcessFile`, {
			method: "POST",
			headers: {
				"Content-Type":
					"application/x-www-form-urlencoded; charset=UTF-8",
				Cookie: `JSESSIONID=${this.sessionId}`,
				Referer: `${this.baseUrl}/`,
				"X-Requested-With": "XMLHttpRequest",
			},
			body: new URLSearchParams({
				file_name: fileName,
				action: "watermark_video",
				key: this.key,
				web: "web",
			}),
		});

		const data = await res.json();

		return {
			instrumental: data.instrumental_path,
			vocal: data.vocal_path,
		};
	}

	async remove(url) {
		await this.init();
		const fileName = await this.uploadFile(url);
		return this.processFile(fileName);
	}
}

// Example usage
// const vr = new VocalRemover();
// vr.remove("https://files.catbox.moe/soeebc.mp3")
//     .then(console.log)
//     .catch(console.error);
