import axios from "axios";
import { basename, extname } from "path";
import qs from "querystring";

export default {
	name: "fetcher",
	description: "Fetch metadata and content from URL.",
	command: ["get", "fetch"],
	permissions: "all",
	category: "tools",
	cooldown: 5,
	wait: null,
	react: true,
	failed: "Failed to %command: %error",
	usage: "$prefix$command <url>",

	execute: async (m, { args, sock }) => {
		const url = args[0] ? args[0].trim() : m.quoted?.url?.trim();

		const urlMatch = url?.match(/https?:\/\/[^\s]+/);
		if (!urlMatch) {
			return m.reply(
				[
					"*🌐 Fetcher Bot Usage*",
					"",
					"*Example Usage:*",
					`⤷ \`${m.prefix + m.command} https://google.com\``,
					"",
					"*Example (POST with Method/Headers):*",
					`⤷ \`${m.prefix + m.command} https://httpbin.org/post --method 'POST' --header 'Authorization: Bearer 123' --data 'name: test'\``,
					"",
					"*Option List:*",
					"• `--method 'GET/POST/DELETE/PUT'`",
					"• `--header 'name: value'`",
					"• `--data 'name: value'`",
					"• `--form 'name: value'`",
					"• `--json`  _(send data as JSON)_",
					"• `--redirect`",
					"• `--head`  _(show response headers only)_",
					"• `--family '0/4/6'`",
				].join("\n")
			);
		}

		const options = parseOptions(m.body.replace(url, ""));

		const axiosConfig = {
			method: (options.method || "GET").toLowerCase(),
			headers: options.headers || {},
			responseType: "arraybuffer",
			validateStatus: () => true,
		};

		if (["POST", "PUT", "DELETE"].includes(axiosConfig.method)) {
			if (options.json) {
				axiosConfig.data = JSON.stringify(options.data || options.form);
				axiosConfig.headers["Content-Type"] = "application/json";
			} else {
				axiosConfig.data = qs.stringify(options.data || options.form);
				axiosConfig.headers["Content-Type"] =
					"application/x-www-form-urlencoded";
			}
		}

		const res = await axios(url, axiosConfig);

		const buffer = res.data;
		const headers = res.headers || {};
		const contentType =
			headers["content-type"] || "application/octet-stream";
		const contentDisposition = headers["content-disposition"] || "";
		const filenameFromHeader =
			contentDisposition.match(/filename="?([^"]+)"?/)?.[1];

		let filename = filenameFromHeader || basename(new URL(url).pathname);
		if (!extname(filename)) {
			const ext = contentType.split("/")[1] || "bin";
			filename += "." + ext;
		}

		if (options.head) {
			const headText = Object.entries(headers)
				.map(([k, v]) => `${k}: ${v}`)
				.join("\n");
			return m.reply(headText);
		}

		if (/^image\//i.test(contentType)) {
			return m.reply(url);
		}

		if (/^video\//i.test(contentType)) {
			return m.reply(url);
		}

		if (/^application\/json/i.test(contentType)) {
			const json = JSON.parse(Buffer.from(buffer).toString());
			return m.reply(JSON.stringify(json, null, 2));
		}

		if (/^text\/html/i.test(contentType)) {
			const html = Buffer.from(buffer).toString();
			return m.reply(
				html.slice(0, 65536) +
					(html.length > 65536 ? "\n\n...(truncated)" : "")
			);
		}

		if (/^text\//i.test(contentType)) {
			const textData = Buffer.from(buffer).toString();
			return m.reply(textData.slice(0, 65536));
		}

		return sock.sendMessage(
			m.from,
			{
				document: buffer,
				mimetype: contentType,
				fileName: filename,
			},
			{ quoted: m, ephemeralExpiration: m.expiration }
		);
	},
};

function parseOptions(text = "") {
	const options = { headers: {}, data: {}, form: {} };
	const methodMatch = text.match(/--method\s+['"]?(\w+)['"]?/i);
	if (methodMatch) {
		options.method = methodMatch[1];
	}
	for (const match of text.matchAll(
		/--headers?\s+['"]([^:]+):\s*([^'"]+)['"]/gi
	)) {
		options.headers[match[1].trim()] = match[2].trim();
	}
	for (const match of text.matchAll(
		/--data\s+['"]([^:]+):\s*([^'"]+)['"]/gi
	)) {
		options.data[match[1].trim()] = match[2].trim();
	}
	for (const match of text.matchAll(
		/--form\s+['"]([^:]+):\s*([^'"]+)['"]/gi
	)) {
		options.form[match[1].trim()] = match[2].trim();
	}

	if (/--json/.test(text)) {
		options.json = true;
	}
	if (/--redirect/.test(text)) {
		options.redirect = true;
	}
	if (/--head/.test(text)) {
		options.head = true;
	}

	const famMatch = text.match(/--family\s+['"]?(\d)['"]?/);
	if (famMatch) {
		options.family = parseInt(famMatch[1], 10);
	}

	return options;
}
