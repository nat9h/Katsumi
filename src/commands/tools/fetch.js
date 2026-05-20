/**
 * @fileoverview Fetch command — make HTTP requests and return the response.
 * @module commands/tools/fetch
 */

import { basename, extname } from "node:path";
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { truncate } from "#libs/utils/format";

export default new CommandBuilder()
    .setName("fetch")
    .setAliases("get", "http", "curl")
    .setDescription("Make an HTTP request and return the response")
    .setUsage(
        "{prefix}{name} <url> [--method] [--header] [--data] [--json] [--head] [--timeout]",
    )
    .setExample("{prefix}fetch https://httpbin.org/get")
    .setNote("Reply to a message containing a URL to use it as the target.")
    .setReact("🌐")
    .setRateLimit(8_000, 3)
    .setHandler(async (interaction) => {
        const source =
            interaction.rawBody.trim() || interaction.quoted?.text || "";
        const urlMatch = source.match(/https?:\/\/[^\s'"]+/);

        if (!urlMatch) {
            return interaction.reply(
                [
                    "🌐 *HTTP Fetcher*\n",
                    "*Usage:*",
                    `\`${interaction.prefix}${interaction.commandName} <url> [options]\`\n`,
                    "*Options:*",
                    "• `--method GET|POST|PUT|DELETE|PATCH`  or  `-X POST`",
                    "• `--header 'Name: Value'`  or  `-H 'Name: Value'`  _(repeatable)_",
                    "• `--data 'key: value'`  or  `-d '{json}'`",
                    "• `--json`  _(send body as JSON)_",
                    "• `--head`  or  `-I`  _(show response headers only)_",
                    "• `--timeout <ms>`  _(default: 15000)_\n",
                    "*Examples:*",
                    `\`${interaction.prefix}${interaction.commandName} https://httpbin.org/get\``,
                    `\`${interaction.prefix}${interaction.commandName} https://httpbin.org/post --method POST --data 'name: test' --json\``,
                    "",
                    "_Or reply to a message containing a URL or curl command._",
                ].join("\n"),
            );
        }

        const url = urlMatch[0];
        const optText = source.replace(url, "");

        const method = (
            optText.match(/--method\s+['"]?(\w+)['"]?/i)?.[1] ||
            optText.match(/-X\s+['"]?(\w+)['"]?/)?.[1] ||
            "GET"
        ).toUpperCase();

        const headers = { "User-Agent": "Mozilla/5.0" };
        for (const m of optText.matchAll(
            /--headers?\s+['"]([^:'"]+):\s*([^'"]+)['"]/gi,
        )) {
            headers[m[1].trim()] = m[2].trim();
        }
        for (const m of optText.matchAll(
            /-H\s+['"]([^:'"]+):\s*([^'"]+)['"]/g,
        )) {
            headers[m[1].trim()] = m[2].trim();
        }

        const data = {};
        for (const m of optText.matchAll(
            /--data\s+['"]([^:'"]+):\s*([^'"]+)['"]/gi,
        )) {
            data[m[1].trim()] = m[2].trim();
        }

        const curlRawBody =
            optText.match(/-d\s+'([^']+)'/s)?.[1] ||
            optText.match(/-d\s+"([^"]+)"/s)?.[1];

        const useJson =
            /--json\b/.test(optText) ||
            (!!curlRawBody &&
                (
                    headers["Content-Type"] ||
                    headers["content-type"] ||
                    ""
                ).includes("json"));
        const headOnly = /--head\b/.test(optText) || /\s-I\b/.test(optText);
        const timeout = Math.min(
            Number(optText.match(/--timeout\s+(\d+)/)?.[1] || 30_000),
            60_000,
        );

        const hasBody =
            ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
            (Object.keys(data).length > 0 || !!curlRawBody);
        let body;
        if (hasBody) {
            if (curlRawBody) {
                body = curlRawBody;
            } else if (useJson) {
                body = JSON.stringify(data);
                headers["Content-Type"] = "application/json";
            } else {
                body = new URLSearchParams(data).toString();
                headers["Content-Type"] = "application/x-www-form-urlencoded";
            }
        }

        let res;
        try {
            res = await axios({
                method: method.toLowerCase(),
                url,
                headers,
                data: body,
                responseType: "arraybuffer",
                timeout,
                maxRedirects: 5,
                validateStatus: () => true,
            });
        } catch (err) {
            return interaction.reply(
                `${err.code === "ECONNABORTED" ? `Request timed out after ${timeout}ms.` : err.message}`,
            );
        }

        const resHeaders = res.headers || {};
        const buffer = Buffer.from(res.data);
        const statusLine = `*${res.status} ${res.statusText || ""}*`;

        if (headOnly) {
            const lines = [statusLine, ""];
            for (const [k, v] of Object.entries(resHeaders)) {
                lines.push(`${k}: ${v}`);
            }
            return interaction.reply(truncate(lines.join("\n"), 65_536));
        }

        const detected = await fileTypeFromBuffer(buffer);
        const mime =
            detected?.mime ||
            (resHeaders["content-type"] || "application/octet-stream")
                .split(";")[0]
                .trim();

        if (/^image\//i.test(mime)) {
            return interaction.reply({ image: buffer, caption: statusLine });
        }

        if (/^video\//i.test(mime)) {
            return interaction.reply({ video: buffer, caption: statusLine });
        }

        if (/^audio\//i.test(mime)) {
            return interaction.reply({ audio: buffer, mimetype: mime });
        }

        if (/^application\/json/i.test(mime)) {
            try {
                const pretty = JSON.stringify(
                    JSON.parse(buffer.toString("utf8")),
                    null,
                    2,
                );
                return interaction.reply(
                    `${statusLine}\n\n\`\`\`json\n${truncate(pretty, 65_536)}\n\`\`\``,
                );
            } catch {
                return interaction.reply(
                    `${statusLine}\n\n${truncate(buffer.toString("utf8"), 65_536)}`,
                );
            }
        }

        if (
            /^text\//i.test(mime) ||
            /^application\/(xml|javascript)/i.test(mime)
        ) {
            const text = buffer.toString("utf8");
            return interaction.reply(
                `${statusLine}\n\n${truncate(text, 65_536)}${text.length > 65_536 ? "\n\n_(truncated)_" : ""}`,
            );
        }

        const fromHeader = (resHeaders["content-disposition"] || "").match(
            /filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i,
        )?.[1];

        const filename = fromHeader
            ? decodeURIComponent(fromHeader.trim())
            : (() => {
                  try {
                      const name = basename(new URL(url).pathname);
                      if (name && name !== "/") {
                          return extname(name)
                              ? name
                              : `${name}.${detected?.ext || "bin"}`;
                      }
                  } catch {}
                  return `response.${detected?.ext || "bin"}`;
              })();

        return interaction.reply({
            document: buffer,
            mimetype: mime,
            fileName: filename,
            caption: statusLine,
        });
    });
