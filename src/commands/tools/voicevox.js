/**
 * @fileoverview VOICEVOX TTS command — Japanese anime voices.
 * @module commands/tools/voicevox
 */

import axios from "axios";
import { getVoiceVox, VoiceVox } from "#libs/scrapers/voicevox";
import { CommandBuilder } from "#libs/structures/CommandBuilder";

const speakerList = Object.keys(VoiceVox.speakers)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

export default new CommandBuilder()
    .setName("voicevox")
    .setAliases("tts")
    .setDescription("Japanese TTS with anime voices (VOICEVOX)")
    .setUsage("{prefix}{name} [speaker] <japanese text>")
    .setExample("{prefix}{name} zundamon こんにちは")
    .setNote(`Speakers:\n${speakerList}\n\nDefault: zundamon`)
    .setReact("🎙")
    .setRateLimit(15_000, 2)
    .setHandler(async (interaction) => {
        const raw = (interaction.body || "").trim();
        if (!raw) {
            return interaction.reply(
                interaction.usage(
                    `\nSpeakers:\n${speakerList}\n\nDefault: zundamon`,
                ),
            );
        }

        const [firstWord, ...rest] = raw.split(/\s+/);
        let speaker = "zundamon";
        let text = raw;

        if (firstWord.toLowerCase() in VoiceVox.speakers) {
            speaker = firstWord.toLowerCase();
            text = rest.join(" ").trim();
        }

        if (!text) {
            return interaction.reply("Provide Japanese text to synthesize.");
        }

        await interaction.typing();
        const vv = getVoiceVox();
        const result = await vv.synthesize(text, speaker);

        const { data: buffer } = await axios.get(result.mp3Url, {
            responseType: "arraybuffer",
            timeout: 60_000,
        });

        return interaction.reply({
            audio: Buffer.from(buffer),
            mimetype: "audio/mpeg",
            ptt: false,
        });
    });
