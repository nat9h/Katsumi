import axios from "axios";

/**
 * Client for the Umamusume VITS TTS synthesizer hosted on Hugging Face Spaces.
 * Supports multiple character voice models and languages.
 */
class UmamusumeTTS {
	static API = "https://plachta-vits-umamusume-voice-synthesizer.hf.space";

	static LANG_LIST = ["日本語", "简体中文", "English", "Mix"];

	static MODEL_LIST = [
		"特别周 Special Week (Umamusume Pretty Derby)",
		"无声铃鹿 Silence Suzuka (Umamusume Pretty Derby)",
		"东海帝王 Tokai Teio (Umamusume Pretty Derby)",
		"丸善斯基 Maruzensky (Umamusume Pretty Derby)",
		"富士奇迹 Fuji Kiseki (Umamusume Pretty Derby)",
		"小栗帽 Oguri Cap (Umamusume Pretty Derby)",
		"黄金船 Gold Ship (Umamusume Pretty Derby)",
		"伏特加 Vodka (Umamusume Pretty Derby)",
		"大和赤骥 Daiwa Scarlet (Umamusume Pretty Derby)",
		"大树快车 Taiki Shuttle (Umamusume Pretty Derby)",
		"草上飞 Grass Wonder (Umamusume Pretty Derby)",
		"菱亚马逊 Hishi Amazon (Umamusume Pretty Derby)",
		"目白麦昆 Mejiro Mcqueen (Umamusume Pretty Derby)",
		"神鹰 El Condor Pasa (Umamusume Pretty Derby)",
		"好歌剧 T.M. Opera O (Umamusume Pretty Derby)",
		"成田白仁 Narita Brian (Umamusume Pretty Derby)",
		"鲁道夫象征 Symboli Rudolf (Umamusume Pretty Derby)",
		"气槽 Air Groove (Umamusume Pretty Derby)",
		"爱丽数码 Agnes Digital (Umamusume Pretty Derby)",
		"青云天空 Seiun Sky (Umamusume Pretty Derby)",
		"玉藻十字 Tamamo Cross (Umamusume Pretty Derby)",
		"美妙 姿势 Fine Motion (Umamusume Pretty Derby)",
		"琵琶晨光 Biwa Hayahide (Umamusume Pretty Derby)",
		"重炮 Mayano Topgun (Umamusume Pretty Derby)",
		"曼城茶座 Manhattan Cafe (Umamusume Pretty Derby)",
		"美普波旁 Mihono Bourbon (Umamusume Pretty Derby)",
		"目白雷恩 Mejiro Ryan (Umamusume Pretty Derby)",
		"雪之美人 Yukino Bijin (Umamusume Pretty Derby)",
		"米浴 Rice Shower (Umamusume Pretty Derby)",
		"艾尼斯风神 Ines Fujin (Umamusume Pretty Derby)",
		"爱丽速子 Agnes Tachyon (Umamusume Pretty Derby)",
		"爱慕织姬 Admire Vega (Umamusume Pretty Derby)",
		"稻荷一 Inari One (Umamusume Pretty Derby)",
		"胜利奖券 Winning Ticket (Umamusume Pretty Derby)",
		"空中神宫 Air Shakur (Umamusume Pretty Derby)",
		"荣进闪耀 Eishin Flash (Umamusume Pretty Derby)",
		"真机伶 Curren Chan (Umamusume Pretty Derby)",
		"川上公主 Kawakami Princess (Umamusume Pretty Derby)",
		"黄金城市 Gold City (Umamusume Pretty Derby)",
		"樱花进王 Sakura Bakushin O (Umamusume Pretty Derby)",
		"采珠 Seeking the Pearl (Umamusume Pretty Derby)",
		"新光风 Shinko Windy (Umamusume Pretty Derby)",
		"东商变革 Sweep Tosho (Umamusume Pretty Derby)",
		"超级小溪 Super Creek (Umamusume Pretty Derby)",
		"醒目飞鹰 Smart Falcon (Umamusume Pretty Derby)",
		"荒 漠英雄 Zenno Rob Roy (Umamusume Pretty Derby)",
		"东瀛佐敦 Tosen Jordan (Umamusume Pretty Derby)",
		"中山庆典 Nakayama Festa (Umamusume Pretty Derby)",
		"成田大进 Narita Taishin (Umamusume Pretty Derby)",
		"西野花 Nishino Flower (Umamusume Pretty Derby)",
		"春乌拉拉 Haru Urara (Umamusume Pretty Derby)",
		"青竹回忆 Bamboo Memory (Umamusume Pretty Derby)",
		"待兼福来 Matikane Fukukitaru (Umamusume Pretty Derby)",
		"名将怒涛 Meisho Doto (Umamusume Pretty Derby)",
		"目白多伯 Mejiro Dober (Umamusume Pretty Derby)",
		"优秀素质 Nice Nature (Umamusume Pretty Derby)",
		"帝 王光环 King Halo (Umamusume Pretty Derby)",
		"待兼诗歌剧 Matikane Tannhauser (Umamusume Pretty Derby)",
		"生野狄杜斯 Ikuno Dictus (Umamusume Pretty Derby)",
		"目白善信 Mejiro Palmer (Umamusume Pretty Derby)",
		"大 拓太阳神 Daitaku Helios (Umamusume Pretty Derby)",
		"双涡轮 Twin Turbo (Umamusume Pretty Derby)",
		"里见光钻 Satono Diamond (Umamusume Pretty Derby)",
		"北部玄驹 Kitasan Black (Umamusume Pretty Derby)",
		"樱花千代 王 Sakura Chiyono O (Umamusume Pretty Derby)",
		"天狼星象征 Sirius Symboli (Umamusume Pretty Derby)",
		"目白阿尔丹 Mejiro Ardan (Umamusume Pretty Derby)",
		"八重无敌 Yaeno Muteki (Umamusume Pretty Derby)",
		"鹤丸刚志 Tsurumaru Tsuyoshi (Umamusume Pretty Derby)",
		"目白光明 Mejiro Bright (Umamusume Pretty Derby)",
		"樱花桂冠 Sakura Laurel (Umamusume Pretty Derby)",
		"成田路 Narita Top Road (Umamusume Pretty Derby)",
		"也文摄 辉 Yamanin Zephyr (Umamusume Pretty Derby)",
		"真弓快车 Aston Machan (Umamusume Pretty Derby)",
		"骏川手纲 Hayakawa Tazuna (Umamusume Pretty Derby)",
		"小林历奇 Kopano Rickey (Umamusume Pretty Derby)",
		"奇锐骏 Wonder Acute (Umamusume Pretty Derby)",
		"秋川理事长 President Akikawa (Umamusume Pretty Derby)",
		"綾地 寧々 Ayachi Nene (Sanoba Witch)",
		"因幡 めぐる Inaba Meguru (Sanoba Witch)",
		"椎葉 紬 Shiiba Tsumugi (Sanoba Witch)",
		"仮屋 和奏 Kariya Wakama (Sanoba Witch)",
		"戸隠 憧子 Togakushi Touko (Sanoba Witch)",
		"九条裟罗 Kujou Sara (Genshin Impact)",
		"芭芭 拉 Barbara (Genshin Impact)",
		"派蒙 Paimon (Genshin Impact)",
		"荒泷一 斗 Arataki Itto (Genshin Impact)",
		"早柚 Sayu (Genshin Impact)",
		"香菱 Xiangling (Genshin Impact)",
		"神里绫华 Kamisato Ayaka (Genshin Impact)",
		"重云 Chongyun (Genshin Impact)",
		"流浪者 Wanderer (Genshin Impact)",
		"优菈 Eula (Genshin Impact)",
		"凝光 Ningguang (Genshin Impact)",
		"钟离 Zhongli (Genshin Impact)",
		"雷电将军 Raiden Shogun (Genshin Impact)",
		"枫原万叶 Kaedehara Kazuha (Genshin Impact)",
		"赛诺 Cyno (Genshin Impact)",
		"诺艾尔 Noelle (Genshin Impact)",
		"八重神子 Yae Miko (Genshin Impact)",
		"凯亚 Kaeya (Genshin Impact)",
		"魈 Xiao (Genshin Impact)",
		"托马 Thoma (Genshin Impact)",
		"可莉 Klee (Genshin Impact)",
		"迪卢克 Diluc (Genshin Impact)",
		"夜兰 Yelan (Genshin Impact)",
		"鹿野院平藏 Shikanoin Heizou (Genshin Impact)",
		"辛焱 Xinyan (Genshin Impact)",
		"丽莎 Lisa (Genshin Impact)",
		"云堇 Yun Jin (Genshin Impact)",
		"坎蒂丝 Candace (Genshin Impact)",
		"罗莎莉亚 Rosaria (Genshin Impact)",
		"北斗 Beidou (Genshin Impact)",
		"珊瑚宫心海 Sangonomiya Kokomi (Genshin Impact)",
		"烟绯 Yanfei (Genshin Impact)",
		"久岐忍 Kuki Shinobu (Genshin Impact)",
		"宵宫 Yoimiya (Genshin Impact)",
		"安柏 Amber (Genshin Impact)",
		"迪奥娜 Diona (Genshin Impact)",
		"班尼特 Bennett (Genshin Impact)",
		"雷泽 Razor (Genshin Impact)",
		"阿贝多 Albedo (Genshin Impact)",
		"温迪 Venti (Genshin Impact)",
		"空 Player Male (Genshin Impact)",
		"神里绫人 Kamisato Ayato (Genshin Impact)",
		"琴 Jean (Genshin Impact)",
		"艾尔海 森 Alhaitham (Genshin Impact)",
		"莫娜 Mona (Genshin Impact)",
		"妮露 Nilou (Genshin Impact)",
		"胡桃 Hu Tao (Genshin Impact)",
		"甘雨 Ganyu (Genshin Impact)",
		"纳西妲 Nahida (Genshin Impact)",
		"刻晴 Keqing (Genshin Impact)",
		"荧 Player Female (Genshin Impact)",
		"埃洛伊 Aloy (Genshin Impact)",
		"柯莱 Collei (Genshin Impact)",
		"多莉 Dori (Genshin Impact)",
		"提纳里 Tighnari (Genshin Impact)",
		"砂糖 Sucrose (Genshin Impact)",
		"行秋 Xingqiu (Genshin Impact)",
		"奥兹 Oz (Genshin Impact)",
		"五郎 Gorou (Genshin Impact)",
		"达达利亚 Tartalia (Genshin Impact)",
		"七七 Qiqi (Genshin Impact)",
		"申鹤 Shenhe (Genshin Impact)",
		"莱依拉 Layla (Genshin Impact)",
		"菲谢尔 Fishl (Genshin Impact)",
	];

	/**
	 * Creates an instance of UmamusumeTTS.
	 * @param {Object} [config={}] - Optional configuration.
	 * @param {string} [config.api] - Custom API base URL. Defaults to the Hugging Face Space endpoint.
	 */
	constructor(config = {}) {
		this.api = config.api || UmamusumeTTS.API;

		this.client = axios.create({
			baseURL: this.api,
			headers: {
				"User-Agent": "Mozilla/5.0",
				"Content-Type": "application/json",
			},
		});
	}

	/**
	 * Pauses execution for a given number of milliseconds.
	 * @param {number} ms - Duration to sleep in milliseconds.
	 * @returns {Promise<void>}
	 */
	sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Picks an item from a list by index (1-based) or by partial string match.
	 * Falls back to the item at `fallback` index if nothing matches.
	 * @param {string[]} list - The list to search in.
	 * @param {number|string} input - A 1-based index or a substring to match against list items.
	 * @param {number} [fallback=0] - Zero-based fallback index if no match is found.
	 * @returns {string} The matched or fallback list item.
	 */
	pick(list, input, fallback = 0) {
		if (typeof input === "number") {
			return list[input - 1] || list[fallback];
		}

		if (typeof input === "string") {
			const find = list.find((v) =>
				v.toLowerCase().includes(input.toLowerCase())
			);

			return find || list[fallback];
		}

		return list[fallback];
	}

	/**
	 * Generates speech audio from text using the TTS API.
	 * Joins the Gradio queue, polls for completion, and returns the audio result.
	 * @param {string} text - The text to synthesize into speech.
	 * @param {Object} [options={}] - Generation options.
	 * @param {number|string} [options.model=1] - Model index (1-based) or partial name to match.
	 * @param {number|string} [options.lang=1] - Language index (1-based) or partial name to match.
	 * @param {number} [options.speed=1] - Speech speed multiplier.
	 * @param {boolean} [options.noise=false] - Whether to add noise to the output.
	 * @returns {Promise<Object>} Result object containing audio URL, metadata, and raw API response.
	 * @throws {Error} If the audio URL is not found in the API response.
	 */
	async generate(text, options = {}) {
		const { model = 1, lang = 1, speed = 1, noise = false } = options;

		const session_hash = Math.random().toString(36).slice(2);

		const modelName = this.pick(UmamusumeTTS.MODEL_LIST, model);

		const langName = this.pick(UmamusumeTTS.LANG_LIST, lang);

		const join = await this.client.post("/gradio_api/queue/join", {
			data: [text, modelName, langName, speed, noise],
			event_data: null,
			fn_index: 2,
			trigger_id: 24,
			session_hash,
		});

		console.log("Event ID:", join.data.event_id);

		while (true) {
			const { data } = await this.client.get(
				`/gradio_api/queue/data?session_hash=${session_hash}`,
				{
					responseType: "text",
				}
			);

			const lines = data.split("\n");

			for (const line of lines) {
				if (!line.startsWith("data:")) {
					continue;
				}

				try {
					const json = JSON.parse(line.replace("data:", "").trim());

					if (json.msg) {
						console.log("[STATUS]", json.msg);
					}

					if (json.msg === "process_completed") {
						const file = json.output?.data?.[1];

						if (!file?.url) {
							throw new Error("Audio URL not found");
						}

						return {
							text,
							model: modelName,
							language: langName,
							speed,
							noise,
							session_hash,
							event_id: json.event_id,
							audio: {
								url: file.url,
								path: file.path,
								name: file.orig_name,
							},
							raw: json,
						};
					}
				} catch {
					// ignore cleanup errors
				}
			}

			await this.sleep(1000);
		}
	}

	/**
	 * Returns the full list of available TTS voice models.
	 * @returns {string[]} Array of model name strings.
	 */
	getModels() {
		return UmamusumeTTS.MODEL_LIST;
	}

	/**
	 * Returns the list of supported languages.
	 * @returns {string[]} Array of language name strings.
	 */
	getLanguages() {
		return UmamusumeTTS.LANG_LIST;
	}
}

export default UmamusumeTTS;
