import { sleep } from "#lib/functions";
import { randomUUID } from "node:crypto";

const getRandomUserAgent = () => {
	const versions = ["133.0.0.0", "134.0.0.0", "135.0.0.0"];
	const version = versions[Math.floor(Math.random() * versions.length)];
	return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
};

class Image2Image {
	constructor() {
		this.refreshIdentity();
	}

	refreshIdentity() {
		this.visitorId = randomUUID();
		this.userAgent = getRandomUserAgent();
		console.log(`Rotation: VisitorID(${this.visitorId.slice(0, 8)}...)`);
	}

	getHeaders(extraHeaders = {}) {
		return {
			accept: "*/*",
			"accept-language": "en-US,en;q=0.9",
			origin: "https://toimage.app",
			referer: "https://toimage.app/",
			"sec-ch-ua-mobile": "?0",
			"sec-ch-ua-platform": '"Windows"',
			"user-agent": this.userAgent,
			"visitor-id": this.visitorId,
			...extraHeaders,
		};
	}

	async getImageBuffer(imageUrl) {
		const response = await fetch(imageUrl);
		if (!response.ok) {
			throw new Error(`Fetch image failed: ${response.statusText}`);
		}
		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer);
	}

	async getSignedUrl(fileName) {
		const url = `https://toimage.app/api/uploads/signed-upload-url?path=images%2F${fileName}&bucket=to-image`;
		const response = await fetch(url, {
			method: "POST",
			headers: this.getHeaders(),
		});
		const json = await response.json();
		return json.signedUrl;
	}

	async uploadToStorage(signedUrl, buffer) {
		const response = await fetch(signedUrl, {
			method: "PUT",
			headers: this.getHeaders({ "Content-Type": "image/png" }),
			body: buffer,
		});
		return response.ok;
	}

	async generateImage(uploadedImageUrl, prompt) {
		const response = await fetch(
			"https://toimage.app/api/task/image/generate",
			{
				method: "POST",
				headers: this.getHeaders({
					"content-type": "application/json",
				}),
				body: JSON.stringify({
					type: "image-to-image",
					prompt,
					num: 1,
					ratio: "auto",
					images: [uploadedImageUrl],
					model: "base",
				}),
			}
		);

		const result = await response.json();

		if (result.message && result.message.includes("generated 3 images")) {
			console.log("[ Limit ] Rotation VisitorID");
			this.refreshIdentity();
			throw new Error("RETRY_WITH_NEW_IDENTITY");
		}

		return result;
	}

	async pollTaskStatus(taskId) {
		while (true) {
			const response = await fetch(
				"https://toimage.app/api/task/recent?type=image-to-image",
				{
					headers: this.getHeaders(),
				}
			);
			const { data } = await response.json();
			const task = data?.find((t) => t.taskId === taskId);

			if (task) {
				process.stdout.write(
					`\rStatus: ${task.status} | Progress: ${task.progress || 0}%`
				);
				if (task.status === "completed") {
					return task.returnValue.images[0];
				}
				if (task.status === "failed") {
					throw new Error("Task generation failed");
				}
			}
			await sleep(3000);
		}
	}
}

async function jembut() {
	const service = new Image2Image();
	const sourceImageUrl =
		"https://i.pinimg.com/1200x/d4/50/83/d450838effd54ae18f35c1e744bc6db3.jpg";
	const prompt = "aesthetic, flowers, oil painting style";

	try {
		const fileName = `${randomUUID()}.png`;

		console.log("Buffering Image...");
		const buffer = await service.getImageBuffer(sourceImageUrl);

		console.log("Getting Signed URL...");
		const signedUrl = await service.getSignedUrl(fileName);

		console.log("Uploading Physical File...");
		await service.uploadToStorage(signedUrl, buffer);

		const publicUrl = `https://pub-0b8e9fd9929944af91cd191de51cb436.r2.dev/images/${fileName}`;

		console.log("Triggering AI Task...");
		const taskResult = await service.generateImage(publicUrl, prompt);

		if (taskResult.code !== 200) {
			throw new Error(taskResult.message);
		}

		const taskId = taskResult.data.taskId;
		console.log(`Polling Task: ${taskId}`);
		const finalImageUrl = await service.pollTaskStatus(taskId);

		console.log("\nSUCCESS:", finalImageUrl);
	} catch (error) {
		if (error.message === "RETRY_WITH_NEW_IDENTITY") {
			return jembut();
		}
		console.error("\nFAILED:", error.message);
	}
}

jembut();
