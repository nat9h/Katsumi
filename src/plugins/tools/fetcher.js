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

	execute: async (m, { args }) => {
		const url = args[0]
			? args[0].trim()
			: m.quoted
				? m.quoted.url?.trim()
				: "";

		const urlMatch = url.match(/https?:\/\/[^\s]+/);
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
					"• \`--method 'GET/POST/DELETE/PUT'\`",
					"• \`--header 'name: value'\`",
					"• \`--data 'name: value'\`",
					"• \`--form 'name: value'\`",
					"• \`--json\`  _(send data as JSON)_",
					"• \`--redirect\`",
					"• \`--head\`  _(show response headers only)_",
					"• \`--family '0/4/6'\`",
				].join("\n")
			);
		}

		const inputText = m.body || "";
		const options = parseOptions(inputText.replace(url, ""));
		const requestOptions = {
			method: options.method || "GET",
			headers: options.headers,
			redirect: options.redirect ? "follow" : "manual",
			family: options.family,
		};

		if (
			["POST", "PUT", "DELETE"].includes(requestOptions.method) &&
			(Object.keys(options.data).length > 0 ||
				Object.keys(options.form).length > 0)
		) {
			if (options.json) {
				requestOptions.body = JSON.stringify(
					options.data || options.form
				);
				requestOptions.headers["Content-Type"] = "application/json";
			} else {
				requestOptions.body = qs.stringify(
					options.data || options.form
				);
				requestOptions.headers["Content-Type"] =
					"application/x-www-form-urlencoded";
			}
		}

		const response = await fetch(url, requestOptions);
		const contentType = response.headers.get("content-type") || "";
		const contentDisposition = response.headers.get("content-disposition");
		const oldFilename =
			contentDisposition
				?.split("filename=")[1]
				?.replace(/["']/g, "")
				.trim() || basename(new URL(url).pathname);

		let ext = extname(oldFilename);
		if (!ext && contentType) {
			const match = contentType.match(/\/([a-z0-9]+)$/i);
			if (match) {
				ext = "." + match[1];
			}
		}

		// const randomPart = randomBytes(4).toString("hex") + "-" + Date.now();
		// const filename = `Natsumi-${randomPart}${ext || ""}`;

		if (options.head) {
			let lines = [];
			for (let [key, value] of response.headers) {
				lines.push(`${key}: ${value}`);
			}
			return m.reply(lines.join("\n"));
		}

		if (/^image\//i.test(contentType)) {
			return m.reply(url);
		}

		if (/^application\/json/i.test(contentType)) {
			const json = await response.json();
			return m.reply(JSON.stringify(json, null, 2));
		}

		if (/^text\/html/i.test(contentType)) {
			const html = await response.text();
			return m.reply(
				html.slice(0, 65536) +
					(html.length > 65536 ? "\n\n...(truncated)" : "")
			);
		}

		if (/^text\//i.test(contentType)) {
			const textData = await response.text();
			return m.reply(textData.slice(0, 65536));
		}

		return m.reply(url);
	},
};

function parseOptions(text = "") {
	let options = { headers: {}, data: {}, form: {} };
	(text.match(/--method\s+['"]?(\w+)['"]?/i) || [])[1] &&
		(options.method = RegExp.$1);
	for (let match of text.matchAll(
		/--headers?\s+['"]([^:]+):\s*([^'"]+)['"]/gi
	)) {
		options.headers[match[1].trim()] = match[2].trim();
	}
	for (let match of text.matchAll(/--data\s+['"]([^:]+):\s*([^'"]+)['"]/gi)) {
		options.data[match[1].trim()] = match[2].trim();
	}
	for (let match of text.matchAll(/--form\s+['"]([^:]+):\s*([^'"]+)['"]/gi)) {
		options.form[match[1].trim()] = match[2].trim();
	}
	/--json/.test(text) && (options.json = true);
	/--redirect/.test(text) && (options.redirect = true);
	/--head/.test(text) && (options.head = true);
	(text.match(/--family\s+['"]?(\d)['"]?/) || [])[1] &&
		(options.family = parseInt(RegExp.$1));
	return options;
}
