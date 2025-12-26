import { BOT_CONFIG } from "#config/index";
import * as db from "#lib/database/index";
import { setAllCommands } from "#lib/prefix";
import print from "#lib/print";
import Store from "#lib/store";
import { APIRequest as api } from "#utils/API/request";
import NodeCache from "@cacheable/node-cache";
import { readdirSync, watch } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PluginManager {
	constructor(botConfig) {
		this.plugins = [];
		this.sessionName = BOT_CONFIG.sessionName;
		this.cooldowns = new NodeCache({ stdTTL: 60 * 60 });
		this.usageLimits = new NodeCache({ stdTTL: 86400 });
		this.botConfig = botConfig;
		this.commandQueues = new Map();
		this.processingStatus = new Map();
		this.debounceTimeout = null;
		this.store = new Store(this.sessionName);
		this.MAX_QUEUE_PER_USER = 5;
		this.periodicTasks = [];
	}

	async loadPlugins() {
		this.plugins = [];
		const pluginsDir = join(__dirname, "../plugins");

		try {
			const pluginFolders = readdirSync(pluginsDir, {
				withFileTypes: true,
			})
				.filter((dirent) => dirent.isDirectory())
				.map((dirent) => dirent.name);

			print.info(`🌱 Loading plugins from: ${pluginsDir}`);

			const pluginLoadPromises = [];

			for (const folder of pluginFolders) {
				const folderPath = join(pluginsDir, folder);
				const pluginFiles = readdirSync(folderPath).filter(
					(file) => file.endsWith(".js") && !file.startsWith("_")
				);

				for (const file of pluginFiles) {
					const absolutePath = join(folderPath, file);
					const pluginURL = pathToFileURL(absolutePath).href;

					pluginLoadPromises.push(
						(async () => {
							try {
								const module = await import(
									`${pluginURL}?update=${Date.now()}`
								);
								const plugin = module.default;

								if (!this.validatePlugin(plugin, file)) {
									return;
								}

								this.configurePluginDefaults(plugin);
								plugin.filePath = absolutePath;
								this.plugins.push(plugin);

								print.info(
									`✔ Loaded: ${plugin.name} (${plugin.command.join(", ")})`
								);
							} catch (error) {
								print.error(
									`❌ Failed to load ${file}:`,
									error
								);
							}
						})()
					);
				}
			}

			await Promise.all(pluginLoadPromises);

			await this.applyPeriodicSettingsFromDB();

			setAllCommands(this.getAllCommands());
			print.info(`🚀 Successfully loaded ${this.plugins.length} plugins`);
			this.logActivePeriodicTasks();
		} catch (dirError) {
			print.error("Plugin directory error:", dirError);
		}
	}

	getAllCommands() {
		return this.plugins.flatMap((plugin) =>
			plugin.command.map((cmd) => cmd.toLowerCase())
		);
	}

	async applyPeriodicSettingsFromDB() {
		try {
			const settings = await db.SettingsModel.getSettings();
			for (const plugin of this.plugins) {
				if (plugin.periodic && typeof plugin.name === "string") {
					const key = plugin.name.toLowerCase();
					if (typeof settings[key] === "boolean") {
						plugin.periodic.enabled = settings[key];
					}
				}
			}
		} catch (e) {
			print.error("Failed to apply periodic settings from DB:", e);
		}
	}

	logActivePeriodicTasks() {
		const periodicInterval = [];
		const periodicMessage = [];
		for (const plugin of this.plugins) {
			const p = plugin.periodic;
			if (p?.enabled && typeof p.run === "function") {
				if (p.type === "interval") {
					periodicInterval.push(plugin.name);
				} else if (p.type === "message" || !p.type) {
					periodicMessage.push(plugin.name);
				}
			}
		}
		if (periodicInterval.length) {
			print.debug(
				`🔁 [Scheduler] Active periodic (interval) tasks: ${periodicInterval.join(", ")}`
			);
		}
		if (periodicMessage.length) {
			print.debug(
				`🔁 [MessageScheduler] Active periodic (message) tasks: ${periodicMessage.join(", ")}`
			);
		}
	}

	watchPlugins() {
		const pluginsDir = join(__dirname, "../plugins");
		print.info(`👀 Watching for plugin changes in: ${pluginsDir}`);

		try {
			const watcher = watch(
				pluginsDir,
				{ recursive: true },
				(eventType, filename) => {
					if (filename && filename.endsWith(".js")) {
						print.info(
							`🔃 Plugin change detected (Event: ${eventType}, File: ${filename}). Reloading...`
						);

						clearTimeout(this.debounceTimeout);
						this.debounceTimeout = setTimeout(async () => {
							await this.loadPlugins();
							setAllCommands(this.getAllCommands());
							this.stopAllPeriodicTasks();
							this.scheduleAllPeriodicTasks(this.sock);
						}, 200);
					}
				}
			);

			watcher.on("error", (error) => {
				print.error("❌ Error in watch:", error);
			});
		} catch (error) {
			print.error("❌ Failed to start watching plugin directory:", error);
		}
	}

	validatePlugin(plugin, filename) {
		if (
			!plugin ||
			!plugin.name ||
			!Array.isArray(plugin.command) ||
			typeof plugin.execute !== "function"
		) {
			print.warn(`⚠ Skipped invalid plugin: ${filename}`);
			return false;
		}
		return true;
	}

	configurePluginDefaults(plugin) {
		const defaults = {
			description: "No description provided",
			permissions: "all",
			hidden: false,
			failed: "❌ Failed executing %command: %error",
			wait: "⏳ Processing your request...",
			category: "general",
			cooldown: 0,
			limit: false,
			dailyLimit: 0,
			usage: "",
			react: true,
			botAdmin: false,
			group: false,
			private: false,
			owner: false,
			experimental: false,
		};

		Object.keys(defaults).forEach((key) => {
			plugin[key] =
				plugin[key] !== undefined ? plugin[key] : defaults[key];
		});
	}

	async enqueueCommand(sock, m) {
		const senderJid = m.sender;

		if (!this.commandQueues.has(senderJid)) {
			this.commandQueues.set(senderJid, []);
		}

		const queue = this.commandQueues.get(senderJid);

		if (queue.length >= this.MAX_QUEUE_PER_USER) {
			print.debug(
				`🚫 Queue full for ${senderJid}. Dropping command: ${m.command}`
			);
			return;
		}

		const isDuplicate = queue.some(
			(item) => item.m.command === m.command && item.m.args === m.args
		);

		if (isDuplicate) {
			print.debug(
				`♻ Skipped duplicate command: ${m.command} from ${senderJid}`
			);
			return;
		}

		queue.push({ sock, m });
		print.debug(
			`📥 Enqueued: ${m.prefix}${m.command} for ${senderJid} (Queue: ${queue.length})`
		);

		if (!this.processingStatus.get(senderJid)) {
			this.processQueue(senderJid);
		}
	}

	async processQueue(senderJid) {
		this.processingStatus.set(senderJid, true);
		const queue = this.commandQueues.get(senderJid) || [];

		if (queue.length === 0) {
			this.processingStatus.set(senderJid, false);
			return;
		}

		const { sock, m } = queue.shift();
		const command = m.command.toLowerCase();
		const plugin = this.plugins.find((p) =>
			p.command.some((cmd) => cmd.toLowerCase() === command)
		);

		try {
			if (!plugin) {
				return this.continueQueue(senderJid);
			}

			const checks = [
				this.checkCooldown(plugin, m, sock),
				this.checkEnvironment(plugin, m, sock),
				this.checkPermissions(plugin, m, sock),
				this.checkUsage(plugin, m, sock),
				this.checkDailyLimit(plugin, m, sock),
			];

			const results = await Promise.all(checks);
			if (results.some((result) => result)) {
				return this.continueQueue(senderJid);
			}

			await this.sendPreExecutionActions(plugin, m, sock);
			await this.executePlugin(plugin, sock, m);
		} catch (error) {
			print.error(`🔥 Processing error for ${senderJid}:`, error);
		} finally {
			this.continueQueue(senderJid);
		}
	}

	continueQueue(senderJid) {
		setImmediate(() => this.processQueue(senderJid));
	}

	async checkCooldown(plugin, m) {
		if (plugin.cooldown <= 0) {
			return false;
		}

		const cooldownKey = `${m.sender}:${plugin.name}`;
		if (this.cooldowns.has(cooldownKey)) {
			const expiry = this.cooldowns.getTtl(cooldownKey);
			let seconds = plugin.cooldown;
			if (typeof expiry === "number") {
				seconds = Math.max(Math.ceil((expiry - Date.now()) / 1000), 0);
			}
			if (seconds > 0) {
				await m.reply(
					`⏳ Cooldown active! Please wait *${seconds}s* before using *${plugin.command[0]}* again`
				);
				if (plugin.react) {
					await m.react("⏳");
				}
				return true;
			}
		}
		return false;
	}

	async checkEnvironment(plugin, m) {
		let error = null;

		if (plugin.group && !m.isGroup) {
			error = "🚫 Group-only command";
		} else if (plugin.private && m.isGroup) {
			error = "🚫 Private-chat only command";
		} else if (plugin.experimental && !this.botConfig.allowExperimental) {
			error = "🚧 Experimental feature disabled";
		}

		if (error) {
			await m.reply(error);
			if (plugin.react) {
				await m.react("❌");
			}
			return true;
		}
		return false;
	}

	async checkPermissions(plugin, m, sock) {
		const isOwner = m.isOwner;
		const isClonebot =
			(m.sock && m.sock.isClonebot) ||
			(typeof sock !== "undefined" && sock.isClonebot);

		let isGroupAdmin = false;
		if (m.isGroup && m.metadata?.participants) {
			const participant = m.metadata.participants.find(
				(p) => p.id === m.sender
			);
			isGroupAdmin =
				participant?.admin === "admin" ||
				participant?.admin === "superadmin";
		}

		if (plugin.owner && !isOwner) {
			await m.reply("🔒 Owner-only command");
			if (plugin.react) {
				await m.react("❌");
			}
			return true;
		}

		if (plugin.owner && isClonebot && !m.isOwner) {
			await m.reply("🔒 Owner-only command");
			if (plugin.react) {
				await m.react("❌");
			}
			return true;
		}

		if (plugin.permissions === "admin" && !isGroupAdmin && !isOwner) {
			await m.reply("👮‍♂️ Admin-only command");
			if (plugin.react) {
				await m.react("❌");
			}
			return true;
		}

		if (plugin.botAdmin && m.isGroup && !m.isBotAdmin) {
			await m.reply("🤖 Bot needs admin privileges");
			if (plugin.react) {
				await m.react("❌");
			}
			return true;
		}

		return false;
	}

	async checkUsage(plugin, m) {
		if (!plugin.usage) {
			return false;
		}

		const args = m.args;
		const hasRequiredArgs = plugin.usage.includes("<");
		const requiresQuoted = plugin.usage.toLowerCase().includes("quoted");

		if (
			(hasRequiredArgs && !args.length && !m.isQuoted) ||
			(requiresQuoted && !m.isQuoted)
		) {
			const usage = plugin.usage
				.replace("$prefix", m.prefix)
				.replace("$command", m.command);

			await m.reply(`📝 Usage:\n\`\`\`${usage}\`\`\``);
			if (plugin.react) {
				await m.react("ℹ️");
			}

			return true;
		}
		return false;
	}

	async checkDailyLimit(plugin, m) {
		if (!plugin.dailyLimit || plugin.dailyLimit <= 0) {
			return false;
		}

		const limitKey = `${m.sender}:${plugin.name}`;
		const usageCount = (this.usageLimits.get(limitKey) || 0) + 1;

		if (usageCount > plugin.dailyLimit) {
			await m.reply(
				`📊 Daily limit reached! (${plugin.dailyLimit}/${plugin.dailyLimit})\n` +
					`Resets in ${this.getResetTime()}`
			);
			if (plugin.react) {
				await m.react("🚫");
			}
			return true;
		}

		this.usageLimits.set(limitKey, usageCount);
		return false;
	}

	getResetTime() {
		const now = new Date();
		const reset = new Date(now);
		reset.setDate(reset.getDate() + 1);
		reset.setHours(0, 0, 0, 0);
		return reset.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	async sendPreExecutionActions(plugin, m) {
		if (plugin.wait) {
			await m.reply(plugin.wait);
		}
		if (plugin.react) {
			await m.react("🔄");
		}
	}

	async executePlugin(plugin, sock, m) {
		const startTime = Date.now();

		const groupMetadata = m.metadata || {};
		const participants = groupMetadata.participants || [];

		const isAdmin =
			m.isGroup &&
			participants.some(
				(p) =>
					p.id === m.sender &&
					(p.admin === "admin" || p.admin === "superadmin")
			);

		const isBotAdmin =
			m.isGroup &&
			participants.some(
				(p) =>
					p.id === sock.user.id &&
					(p.admin === "admin" || p.admin === "superadmin")
			);

		const params = {
			sock,
			m,
			text: m.text,
			args: m.args,
			plugins: this.plugins,
			command: m.command,
			prefix: m.prefix,
			isOwner: m.isOwner,
			groupMetadata,
			isAdmin,
			isBotAdmin,
			api,
			db,
			store: this.store,
			pluginManager: this,
		};

		try {
			print.info(
				`⚡ Executing: ${plugin.name} by ${m.pushName} [${m.sender}]`
			);

			if (plugin.execute.length === 1) {
				await plugin.execute(m);
			} else {
				const { m, ...rest } = params;
				await plugin.execute(m, rest);
			}

			if (plugin.cooldown > 0) {
				this.cooldowns.set(
					`${m.sender}:${plugin.name}`,
					true,
					plugin.cooldown
				);
			}

			if (plugin.react) {
				await m.react("✅");
			}

			const duration = Date.now() - startTime;
			print.info(`✓ Executed ${plugin.name} in ${duration}ms`);
		} catch (error) {
			print.error(`⚠ Plugin ${plugin.name} failed:`, error);

			const fullCommand = m.prefix + m.command;
			const errorMessage = plugin.failed
				.replace("%command", fullCommand)
				.replace("%error", error.message || "Internal error");

			await m.reply(errorMessage);

			if (plugin.react) {
				await m.react("❌");
			}
		}
	}

	getPlugins() {
		return this.plugins;
	}

	getQueueStatus() {
		return {
			totalQueues: this.commandQueues.size,
			queues: Array.from(this.commandQueues.entries()).map(
				([jid, queue]) => ({
					jid,
					count: queue.length,
				})
			),
		};
	}

	async runPeriodicMessagePlugins(m, sock) {
		for (const plugin of this.plugins) {
			const periodic = plugin.periodic;
			if (
				periodic?.enabled &&
				(periodic.type === "message" || !periodic.type) &&
				typeof periodic.run === "function"
			) {
				try {
					await periodic.run(m, { sock, pluginManager: this });
				} catch (err) {
					print.error(`[Periodic ${plugin.name}] Error:`, err);
				}
			}
		}
	}

	startPeriodicTask(plugin) {
		const periodic = plugin.periodic;

		if (
			!periodic ||
			periodic.type !== "interval" ||
			typeof periodic.run !== "function" ||
			!periodic.interval
		) {
			return;
		}

		const exists = this.periodicTasks.find((t) => t.name === plugin.name);
		if (exists) {
			return;
		}

		const timer = setInterval(
			() =>
				periodic.run(undefined, {
					sock: this.sock,
					pluginManager: this,
				}),
			periodic.interval
		);

		this.periodicTasks.push({ name: plugin.name, timer });
		print.debug(
			`⏰ [Scheduler] Task '${plugin.name}' scheduled every ${periodic.interval / 1000}s`
		);
	}

	stopPeriodicTask(name) {
		const index = this.periodicTasks.findIndex((t) => t.name === name);
		if (index === -1) {
			return;
		}

		clearInterval(this.periodicTasks[index].timer);
		this.periodicTasks.splice(index, 1);
		print.debug(`🛑 [Scheduler] Task '${name}' stopped`);
	}

	/**
	 * Only periodic with type: 'interval' is scheduled here.
	 * Periodic with type: 'message' is called in message handler.
	 */
	scheduleAllPeriodicTasks(sock) {
		this.sock = sock;
		print.debug(
			`🚦 [Scheduler] Initiating periodic task scheduling for ${this.plugins.length} plugins...`
		);

		this.plugins.forEach((plugin) => {
			const periodic = plugin.periodic;
			if (!periodic) {
				return;
			}

			const enabled = !!periodic.enabled;

			if (
				enabled &&
				periodic.type === "interval" &&
				typeof periodic.run === "function"
			) {
				this.startPeriodicTask(plugin);
			} else if (
				enabled &&
				periodic.type &&
				periodic.type !== "interval" &&
				periodic.type !== "message"
			) {
				print.warn(
					`[Scheduler] WARNING: Plugin '${plugin.name}' uses unknown periodic type '${periodic.type}'`
				);
			}
		});

		if (!this.periodicTasks.length) {
			print.debug(
				"⚠️ [Scheduler] No periodic tasks registered. All clear!"
			);
		} else {
			print.debug(
				`✅ [Scheduler] All periodic interval tasks are now active. Total: ${this.periodicTasks.length}`
			);
		}
	}

	stopAllPeriodicTasks() {
		for (const { timer } of this.periodicTasks) {
			clearInterval(timer);
		}
		this.periodicTasks = [];
		print.debug("🛑 All periodic interval tasks stopped.");
	}

	async handleAfterPlugins(m, sock) {
		const params = {
			sock,
			text: m.text,
			args: m.args,
			plugins: this.plugins,
			command: m.command,
			prefix: m.prefix,
			isOwner: m.isOwner,
			groupMetadata: m.metadata,
			isAdmin: m.isAdmin,
			isBotAdmin: m.isBotAdmin,
			api,
		};
		for (const plugin of this.plugins) {
			if (typeof plugin.after === "function") {
				try {
					if (plugin.after.length === 1) {
						await plugin.after(m);
					} else {
						await plugin.after(m, params);
					}
				} catch (err) {
					console.error(
						`Error in after() of plugin "${plugin.name}":`,
						err
					);
				}
			}
		}
	}
}

export default PluginManager;
