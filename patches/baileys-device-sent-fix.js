/**
 * Patch for baileys v7.0.0-rc11
 * Preserves messageContextInfo (including messageSecret) when unwrapping
 * deviceSentMessage payloads. Required for self-mode edit message decryption.
 *
 * Based on: https://github.com/WhiskeySockets/Baileys/pull/2566
 *
 * Run: node patches/baileys-device-sent-fix.js
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const filePath = join(
    process.cwd(),
    "node_modules/baileys/lib/Utils/decode-wa-message.js",
);

const content = readFileSync(filePath, "utf8");

const oldCode = `let msg = proto.Message.decode(e2eType !== 'plaintext' ? unpadRandomMax16(msgBuffer) : msgBuffer);
                        msg = msg.deviceSentMessage?.message || msg;`;

const newCode = `let msg = proto.Message.decode(e2eType !== 'plaintext' ? unpadRandomMax16(msgBuffer) : msgBuffer);
                        const outerContextInfo = msg.messageContextInfo;
                        msg = msg.deviceSentMessage?.message || msg;
                        if (outerContextInfo && !msg.messageContextInfo) {
                            msg.messageContextInfo = outerContextInfo;
                        }`;

if (content.includes("outerContextInfo")) {
    console.log("Patch already applied.");
    process.exit(0);
}

if (!content.includes(oldCode)) {
    console.error("Could not find target code to patch. Baileys version may have changed.");
    process.exit(1);
}

writeFileSync(filePath, content.replace(oldCode, newCode), "utf8");
console.log("Patched baileys: deviceSentMessage now preserves messageContextInfo.");
