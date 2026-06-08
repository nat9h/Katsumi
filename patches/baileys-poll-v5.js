/**
 * Patch for baileys — adds pollCreationMessageV5 (quiz) recognition.
 *
 * Baileys' getMessageType() and getAggregateVotesInPollMessage() only knew
 * poll versions up to V3. The bot's sendQuiz() uses pollCreationMessageV5,
 * so without this patch the quiz message is NOT classified as a 'poll' during
 * relay — meaning it shows on the sender's side but never reaches recipients.
 *
 * This patch teaches both functions about V4/V5.
 *
 * Run: node patches/baileys-poll-v5.js
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let patched = 0;

{
    const filePath = join(
        process.cwd(),
        "node_modules/baileys/lib/Socket/messages-send.js",
    );
    let content = readFileSync(filePath, "utf8");

    const oldCode = `        if (normalizedMessage.pollCreationMessage ||
            normalizedMessage.pollCreationMessageV2 ||
            normalizedMessage.pollCreationMessageV3 ||
            normalizedMessage.pollUpdateMessage) {
            return 'poll';
        }`;
    const newCode = `        if (normalizedMessage.pollCreationMessage ||
            normalizedMessage.pollCreationMessageV2 ||
            normalizedMessage.pollCreationMessageV3 ||
            normalizedMessage.pollCreationMessageV4 ||
            normalizedMessage.pollCreationMessageV5 ||
            normalizedMessage.pollUpdateMessage) {
            return 'poll';
        }`;

    if (content.includes("pollCreationMessageV5")) {
        console.log("messages-send.js already patched for poll V5.");
    } else if (!content.includes(oldCode)) {
        console.error(
            "Could not find getMessageType poll target. Baileys version may have changed.",
        );
        process.exit(1);
    } else {
        writeFileSync(filePath, content.replace(oldCode, newCode), "utf8");
        patched++;
    }
}

{
    const filePath = join(
        process.cwd(),
        "node_modules/baileys/lib/Utils/messages.js",
    );
    let content = readFileSync(filePath, "utf8");

    const oldCode = `    const opts = message?.pollCreationMessage?.options ||
        message?.pollCreationMessageV2?.options ||
        message?.pollCreationMessageV3?.options ||
        [];`;
    const newCode = `    const opts = message?.pollCreationMessage?.options ||
        message?.pollCreationMessageV2?.options ||
        message?.pollCreationMessageV3?.options ||
        message?.pollCreationMessageV4?.options ||
        message?.pollCreationMessageV5?.options ||
        [];`;

    if (content.includes("pollCreationMessageV5")) {
        console.log("messages.js already patched for poll V5.");
    } else if (!content.includes(oldCode)) {
        console.error(
            "Could not find getAggregateVotesInPollMessage target. Baileys version may have changed.",
        );
        process.exit(1);
    } else {
        writeFileSync(filePath, content.replace(oldCode, newCode), "utf8");
        patched++;
    }
}

if (patched > 0) {
    console.log(`Patched baileys: pollCreationMessageV5 support added (${patched} file(s)).`);
} else {
    console.log("Poll V5 patch already applied.");
}
