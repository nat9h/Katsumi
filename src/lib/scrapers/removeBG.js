import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import FormData from "form-data";
import { basename } from "node:path";

class RemoveBgError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = "RemoveBgError";
		this.cause = options.cause ?? null;
		this.code = options.code ?? "REMOVE_BG_ERROR";
		this.status = options.status ?? null;
	}
}

class RemoveBG {
	static headers = {
		accept: "application/json, text/plain, */*",
		"accept-language": "en-US,en;q=0.9",
		origin: "https://www.iloveimg.com",
		referer: "https://www.iloveimg.com/",
		"user-agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.6844.89 Safari/537.36",
	};

	constructor(options = {}) {
		this.timeout = options.timeout ?? 20_000;
		this.maxRetries = options.maxRetries ?? 1;
		this.session = null;

		this.headers = {
			...RemoveBG.headers,
			...(options.headers || {}),
		};

		this.http = axios.create({
			timeout: this.timeout,
			headers: this.headers,
			validateStatus: (status) => status >= 200 && status < 300,
		});
	}

	randomItem(arr = []) {
		return arr[Math.floor(Math.random() * arr.length)];
	}

	getNameFromUrl(url, fallbackExt = "jpg") {
		try {
			const pathname = new URL(url).pathname;
			const base = basename(pathname);
			return base && base !== "/" ? base : `image.${fallbackExt}`;
		} catch {
			return `image.${fallbackExt}`;
		}
	}

	async getImageMeta(buffer) {
		if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
			throw new RemoveBgError("Input must be a buffer.", {
				code: "INVALID_BUFFER",
			});
		}

		const type = await fileTypeFromBuffer(buffer);

		if (!type || !type.mime?.startsWith("image/")) {
			throw new RemoveBgError("Unsupported file.", {
				code: "UNSUPPORTED_FILE",
			});
		}

		return type;
	}

	parseSessionFromHtml(html) {
		if (typeof html !== "string" || !html.trim()) {
			throw new RemoveBgError("Empty HTML.", {
				code: "EMPTY_HTML",
			});
		}

		const configRaw = html.match(
			/var\s+ilovepdfConfig\s*=\s*({.*?});/s
		)?.[1];
		if (!configRaw) {
			throw new RemoveBgError("Config not found.", {
				code: "CONFIG_NOT_FOUND",
			});
		}

		let config;
		try {
			config = JSON.parse(configRaw);
		} catch (cause) {
			throw new RemoveBgError("Invalid config.", {
				code: "INVALID_CONFIG_JSON",
				cause,
			});
		}

		const taskId =
			config?.taskId ||
			html.match(/taskId\s*[:=]\s*['"]([a-zA-Z0-9_-]+)['"]/)?.[1] ||
			html.match(/ilovepdfConfig\.taskId\s*=\s*['"](.+?)['"];/)?.[1];

		const token =
			config?.token ||
			html.match(/(eyJ[a-zA-Z0-9._-]+)/)?.[1] ||
			html.match(/Bearer\s+([a-zA-Z0-9._-]+)/i)?.[1];

		const servers = config?.servers;

		if (!taskId) {
			throw new RemoveBgError("Task ID not found.", {
				code: "TASK_ID_NOT_FOUND",
			});
		}

		if (!token) {
			throw new RemoveBgError("Token not found.", {
				code: "TOKEN_NOT_FOUND",
			});
		}

		if (!Array.isArray(servers) || servers.length === 0) {
			throw new RemoveBgError("Server list empty.", {
				code: "SERVER_LIST_EMPTY",
			});
		}

		const server = this.randomItem(servers);

		return {
			taskId,
			token,
			server,
			baseURL: `https://${server}.iloveimg.com`,
		};
	}

	async initSession(force = false) {
		if (this.session && !force) {
			return this.session;
		}

		try {
			const { data: html } = await this.http.get(
				"https://www.iloveimg.com/remove-background"
			);

			this.session = this.parseSessionFromHtml(html);
			return this.session;
		} catch (cause) {
			throw new RemoveBgError(`Init session failed: ${cause.message}`, {
				code: "INIT_SESSION_FAILED",
				cause,
				status: cause?.response?.status ?? null,
			});
		}
	}

	createUploadForm({ buffer, filename, mime, taskId }) {
		const form = new FormData();
		form.append("name", filename);
		form.append("chunk", "0");
		form.append("chunks", "1");
		form.append("task", taskId);
		form.append("preview", "1");
		form.append("pdfinfo", "0");
		form.append("pdfforms", "0");
		form.append("pdfresetforms", "0");
		form.append("v", "web.0");
		form.append("file", buffer, {
			filename,
			contentType: mime,
		});
		return form;
	}

	createRemoveForm({ taskId, serverFilename }) {
		const form = new FormData();
		form.append("task", taskId);
		form.append("server_filename", serverFilename);
		return form;
	}

	async upload(buffer, filename = "image") {
		const session = await this.initSession();
		const { mime, ext } = await this.getImageMeta(buffer);

		const finalName = /\.[a-z0-9]+$/i.test(filename)
			? filename
			: `${filename}.${ext}`;

		const form = this.createUploadForm({
			buffer,
			filename: finalName,
			mime,
			taskId: session.taskId,
		});

		try {
			const { data } = await axios.post(
				`${session.baseURL}/v1/upload`,
				form,
				{
					headers: {
						...this.headers,
						...form.getHeaders(),
						authorization: `Bearer ${session.token}`,
					},
					timeout: this.timeout,
				}
			);

			if (!data?.server_filename) {
				throw new RemoveBgError(
					"Upload invalid: server_filename is empty.",
					{
						code: "UPLOAD_INVALID_RESPONSE",
					}
				);
			}

			return data.server_filename;
		} catch (cause) {
			throw new RemoveBgError(`Upload failed: ${cause.message}`, {
				code: "UPLOAD_FAILED",
				cause,
				status: cause?.response?.status ?? null,
			});
		}
	}

	async remove(serverFilename) {
		if (!serverFilename) {
			throw new RemoveBgError("Missing server filename.", {
				code: "MISSING_SERVER_FILENAME",
			});
		}

		const session = await this.initSession();
		const form = this.createRemoveForm({
			taskId: session.taskId,
			serverFilename,
		});

		try {
			const { data } = await axios.post(
				`${session.baseURL}/v1/removebackground`,
				form,
				{
					headers: {
						...this.headers,
						...form.getHeaders(),
						authorization: `Bearer ${session.token}`,
						accept: "*/*",
					},
					responseType: "arraybuffer",
					timeout: this.timeout,
				}
			);

			const result = Buffer.from(data);
			if (!result.length) {
				throw new RemoveBgError("Empty result.", {
					code: "EMPTY_RESULT",
				});
			}

			return result;
		} catch (cause) {
			throw new RemoveBgError(`Remove failed: ${cause.message}`, {
				code: "REMOVE_FAILED",
				cause,
				status: cause?.response?.status ?? null,
			});
		}
	}

	async process(buffer, filename = "image") {
		let lastError;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				if (attempt > 0) {
					await this.initSession(true);
				}

				const serverFilename = await this.upload(buffer, filename);
				return await this.remove(serverFilename);
			} catch (error) {
				lastError = error;
			}
		}

		throw lastError;
	}

	async fromBuffer(buffer, filename = "image") {
		return this.process(buffer, filename);
	}

	async fromUrl(url) {
		if (!url || typeof url !== "string") {
			throw new RemoveBgError("Invalid URL.", {
				code: "INVALID_URL",
			});
		}

		try {
			const { data } = await axios.get(url, {
				responseType: "arraybuffer",
				timeout: this.timeout,
				headers: {
					"user-agent": this.headers["user-agent"],
				},
			});

			const buffer = Buffer.from(data);
			const { ext } = await this.getImageMeta(buffer);
			const filename = this.getNameFromUrl(url, ext);

			return await this.fromBuffer(buffer, filename);
		} catch (cause) {
			if (cause instanceof RemoveBgError) {
				throw cause;
			}

			throw new RemoveBgError(
				`Failed process from URL: ${cause.message}`,
				{
					code: "FROM_URL_FAILED",
					cause,
					status: cause?.response?.status ?? null,
				}
			);
		}
	}
}

export default RemoveBG;
