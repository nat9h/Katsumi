/**
 * @fileoverview VOICEVOX TTS via api.tts.quest — Japanese anime voices.
 * @module scrapers/voicevox
 */

import axios from "axios";

export class VoiceVox {
    static #API = "https://api.tts.quest/v3/voicevox/synthesis";

    static speakers = Object.freeze({
        // ずんだもん (Zundamon) — the mascot, most popular
        zundamon: 3,
        "zundamon-amaama": 1,
        "zundamon-tsuntsun": 7,
        "zundamon-sexy": 5,
        "zundamon-whisper": 22,
        "zundamon-hisohiso": 38,
        // 四国めたん (Shikoku Metan)
        metan: 2,
        "metan-amaama": 0,
        "metan-tsuntsun": 6,
        "metan-sexy": 4,
        "metan-whisper": 36,
        // 春日部つむぎ (Kasukabe Tsumugi)
        tsumugi: 8,
        // 波音リツ (Namine Ritsu)
        ritsu: 9,
        "ritsu-queen": 65,
        // 雨晴はう (Amehare Hau)
        hau: 10,
        // 玄野武宏 (Kurono Takehiro)
        takehiro: 11,
        // 白上虎太郎 (Shirakami Kotarou)
        kotarou: 12,
        "kotarou-waai": 32,
        "kotarou-bicchiri": 33,
        "kotarou-hehehe": 34,
        "kotarou-uhehe": 35,
        // 青山龍星 (Aoyama Ryusei)
        ryusei: 13,
        // 冥鳴ひまり (Meimei Himari)
        himari: 14,
        // 九州そら (Kyushu Sora)
        sora: 16,
        "sora-amaama": 15,
        "sora-tsuntsun": 18,
        "sora-sexy": 17,
        "sora-whisper": 19,
        // もち子さん (Mochiko-san)
        mochiko: 20,
        // 剣崎雌雄 (Kenzaki Mesuo)
        kenzaki: 21,
        // WhiteCUL
        whitecul: 23,
        "whitecul-cry": 24,
        "whitecul-scared": 25,
        "whitecul-fun": 26,
        // 後鬼 (Goki)
        goki: 27,
        "goki-yin": 28,
        // No.7
        no7: 29,
        "no7-anger": 30,
        "no7-sad": 31,
        // ちび式じい (Chibi-Shikijii)
        chibishikijii: 42,
        // 櫻歌ミコ (Ouka Miko)
        miko: 43,
        "miko-2nd": 44,
        "miko-loli": 45,
        // 小夜/SAYO
        sayo: 46,
        // ナースロボ＿タイプＴ (Nurse Robo Type-T)
        nurse: 47,
        "nurse-scared": 48,
        "nurse-happy": 49,
        "nurse-hisohiso": 50,
        // 春歌ナナ (Haruka Nana)
        nana: 54,
        // 猫使アル (Nekotsuka Aru)
        aru: 55,
        "aru-noruma": 56,
        "aru-relax": 57,
        // 猫使ビィ (Nekotsuka Bii)
        bii: 58,
        "bii-noruma": 59,
        "bii-relax": 60,
        // 中国うさぎ (Chugoku Usagi)
        usagi: 61,
        // 栗田まろん (Kurita Maron)
        maron: 67,
        // あいえるたん (Aieru-tan)
        aieru: 68,
        // 満別花丸 (Manbetsu Hanamaru)
        hanamaru: 69,
        // 琴詠ニア (Kotoyomi Nia)
        nia: 74,
    });

    resolveSpeaker(speaker) {
        if (typeof speaker === "number") {
            return speaker;
        }
        const key = String(speaker).toLowerCase();
        if (key in VoiceVox.speakers) {
            return VoiceVox.speakers[key];
        }
        const n = Number(key);
        if (Number.isFinite(n)) {
            return n;
        }
        throw new Error(`Unknown VoiceVox speaker: ${speaker}`);
    }

    /**
     * Synthesize Japanese text to speech.
     * @param {string} text
     * @param {string|number} [speaker=3] - speaker name or numeric id
     * @param {{ timeout?: number, pollMs?: number }} [opts]
     * @returns {Promise<{ speaker: number, text: string, mp3Url: string, wavUrl: string }>}
     */
    async synthesize(
        text,
        speaker = 3,
        { timeout = 60_000, pollMs = 1500 } = {},
    ) {
        if (!text?.trim()) {
            throw new Error("Text is required.");
        }
        const speakerId = this.resolveSpeaker(speaker);

        const { data } = await axios.get(VoiceVox.#API, {
            params: { text, speaker: speakerId },
            timeout: 15_000,
        });
        if (!data?.success) {
            throw new Error(data?.errorMessage || "VoiceVox request failed.");
        }

        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const { data: status } = await axios.get(data.audioStatusUrl, {
                timeout: 10_000,
            });
            if (status.isAudioError) {
                throw new Error("VoiceVox audio generation failed.");
            }
            if (status.isAudioReady) {
                return {
                    speaker: speakerId,
                    text,
                    mp3Url: data.mp3DownloadUrl,
                    wavUrl: data.wavDownloadUrl,
                };
            }
            await new Promise((r) => setTimeout(r, pollMs));
        }
        throw new Error("VoiceVox synthesis timed out.");
    }
}

let _shared;
export function getVoiceVox() {
    if (!_shared) {
        _shared = new VoiceVox();
    }
    return _shared;
}
