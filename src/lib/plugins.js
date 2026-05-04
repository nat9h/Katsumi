import { BOT_CONFIG } from "#config/index";
import * as db from "#lib/database/index";
import { setAllCommands } from "#lib/prefix";
import print from "#lib/print";
import Store from "#lib/store";
import TaskScheduler from "#lib/taskScheduler";
import { APIRequest as api } from "#utils/API/request";
import NodeCache from "@cacheable/node-cache";
import { readdirSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PluginManager {
	constructor(botConfig) {
		this.botConfig = botConfig;
		this.sessionName = BOT_CONFIG.sessionName || "natsumiworld";
		this.store = new Store(this.sessionName);
		this.scheduler = new TaskScheduler(this);
		this.plugins = [];
		this.cooldowns = new NodeCache({ stdTTL: 60 * 60 });
		this.usageLimits = new NodeCache({ stdTTL: 86400 });
		this.commandQueues = new Map();
		this.processingStatus = new Map();
		this.MAX_QUEUE_PER_USER = 5;
		this.reloadDebounces = new Map();
	}

	/**
	 * Stable key for user-scoped cache/queue.
	 * Prefer PN if available (m.senderPn), fallback PN/LID.
	 * Prevents split identities when WA returns LID sometimes and PN other times.
	 */
	getStableSenderKey(m) {
		return m?.senderPn || m?.sender || m?.senderLid || "";
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

			const pluginLoadPromises = pluginFolders.flatMap((folder) => {
				const folderPath = join(pluginsDir, folder);
				const pluginFiles = readdirSync(folderPath).filter(
					(file) => file.endsWith(".js") && !file.startsWith("_")
				);

				return pluginFiles.map(async (file) => {
					const absolutePath = join(folderPath, file);
					const pluginURL = pathToFileURL(absolutePath).href;

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
						print.error(`❌ Failed to load ${file}:`, error);
					}
				});
			});

			await Promise.all(pluginLoadPromises);

			await this.scheduler.applyPeriodicSettingsFromDB(this.plugins);
			this.scheduler.logActiveTasks(this.plugins);

			setAllCommands(this.getAllCommands());
			print.info(`🚀 Successfully loaded ${this.plugins.length} plugins`);
		} catch (dirError) {
			print.error("Plugin directory error:", dirError);
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
		if (!this.isValidUsage(plugin.usage)) {
			print.warn(
				`⚠ Invalid usage format in plugin: ${filename}. Expected string or string[]`
			);
			return false;
		}
		return true;
	}

	configurePluginDefaults(plugin) {
		const defaults = {
			description: "No description provided",
			permissions: "all",
			hidden: false,
			failed: "Failed executing %command: %error",
			wait: "Processing your request...",
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
		Object.assign(plugin, { ...defaults, ...plugin });
	}

	getAllCommands() {
		return this.plugins.flatMap((plugin) =>
			plugin.command.map((cmd) => cmd.toLowerCase())
		);
	}

	getPlugins() {
		return this.plugins;
	}

	async enqueueCommand(sock, m) {
		const senderKey = this.getStableSenderKey(m);
		if (!senderKey) {
			return;
		}

		if (!this.commandQueues.has(senderKey)) {
			this.commandQueues.set(senderKey, []);
		}

		const queue = this.commandQueues.get(senderKey);

		if (queue.length >= this.MAX_QUEUE_PER_USER) {
			print.debug(
				`🚫 Queue full for ${senderKey}. Dropping command: ${m.command}`
			);
			return;
		}

		const isDuplicate = queue.some(
			(item) => item.m.command === m.command && item.m.args === m.args
		);
		if (isDuplicate) {
			print.debug(
				`♻ Skipped duplicate command: ${m.command} from ${senderKey}`
			);
			return;
		}

		queue.push({ sock, m });
		print.debug(
			`📥 Enqueued: ${m.prefix}${m.command} for ${senderKey} (Queue: ${queue.length})`
		);

		if (!this.processingStatus.get(senderKey)) {
			this.processQueue(senderKey);
		}
	}

	async processQueue(senderKey) {
		this.processingStatus.set(senderKey, true);
		const queue = this.commandQueues.get(senderKey) || [];

		if (queue.length === 0) {
			this.processingStatus.delete(senderKey);
			this.commandQueues.delete(senderKey);
			return;
		}

		const { sock, m } = queue.shift();
		const command = (m.command || "").toLowerCase();
		const plugin = this.plugins.find((p) =>
			p.command.some((cmd) => cmd.toLowerCase() === command)
		);

		try {
			if (!plugin) {
				return;
			}

			const results = await Promise.all([
				this.checkCooldown(plugin, m),
				this.checkEnvironment(plugin, m),
				this.checkPermissions(plugin, m, sock),
				this.checkUsage(plugin, m),
				this.checkDailyLimit(plugin, m),
			]);

			if (results.some(Boolean)) {
				return;
			}

			await this.sendPreExecutionActions(plugin, m);
			await this.executePlugin(plugin, sock, m);
		} catch (error) {
			print.error(`🔥 Processing error for ${senderKey}:`, error);
		} finally {
			setImmediate(() => this.processQueue(senderKey));
		}
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

	async checkCooldown(plugin, m) {
		if (plugin.cooldown <= 0) {
			return false;
		}
		const senderKey = this.getStableSenderKey(m);
		const cooldownKey = `${senderKey}:${plugin.name}`;

		if (this.cooldowns.has(cooldownKey)) {
			const expiry = this.cooldowns.getTtl(cooldownKey);
			const seconds =
				typeof expiry === "number"
					? Math.max(Math.ceil((expiry - Date.now()) / 1000), 0)
					: plugin.cooldown;

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

	/**
	 * LID/PN-safe permission checks.
	 * In v7, participants use id + optional phoneNumber/lid. Admin role is in p.admin.
	 * See Baileys group participant extraction & dual identity notes.
	 */
	async checkPermissions(plugin, m, sock) {
		const isOwner = m.isOwner;
		const isClonebot = m.sock?.isClonebot || sock?.isClonebot;
		let isGroupAdmin = false;

		if (m.isGroup && m.metadata?.participants) {
			const digits = (v) =>
				typeof v === "string" ? v.replace(/\D/g, "") : "";
			const senderNum = digits(m.senderPn || m.sender);
			const senderLid =
				m.senderLid ||
				(typeof m.sender === "string" &&
				/@lid$|@hosted\.lid$/.test(m.sender)
					? m.sender
					: null);

			const participant = m.metadata.participants.find((p) => {
				const pNum =
					digits(p?.phoneNumber) ||
					(p?.id && !/@lid$|@hosted\.lid$/.test(p.id)
						? digits(p.id)
						: "");
				return (
					(senderNum && pNum && senderNum === pNum) ||
					(senderLid && p?.id && senderLid === p.id)
				);
			});

			isGroupAdmin =
				participant?.admin === "admin" ||
				participant?.admin === "superadmin";
		}

		const replyReject = async (msg) => {
			await m.reply(msg);
			if (plugin.react) {
				await m.react("❌");
			}
			return true;
		};

		if (plugin.owner && !isOwner) {
			return replyReject("🔒 Owner-only command");
		}
		if (plugin.owner && isClonebot && !isOwner) {
			return replyReject("🔒 Owner-only command");
		}
		if (plugin.permissions === "admin" && !isGroupAdmin && !isOwner) {
			return replyReject("👮‍♂️ Admin-only command");
		}
		if (plugin.botAdmin && m.isGroup && !m.isBotAdmin) {
			return replyReject("🤖 Bot needs admin privileges");
		}

		return false;
	}

	isValidUsage(usage) {
		return (
			usage === undefined ||
			typeof usage === "string" ||
			(Array.isArray(usage) && usage.every((i) => typeof i === "string"))
		);
	}

	getUsageText(usage) {
		return usage
			? Array.isArray(usage)
				? usage.join("\n")
				: String(usage)
			: "";
	}

	formatUsage(usage, m) {
		return (Array.isArray(usage) ? usage : [usage])
			.filter(Boolean)
			.map((line) =>
				String(line)
					.replace(/\$prefix/g, m.prefix)
					.replace(/\$command/g, m.command)
			)
			.join("\n");
	}

	async checkUsage(plugin, m) {
		const usageText = this.getUsageText(plugin.usage);
		if (!usageText) {
			return false;
		}

		const hasRequiredArgs = usageText.includes("<");
		const requiresQuoted = usageText.toLowerCase().includes("quoted");

		if (
			(hasRequiredArgs && !m.args.length && !m.isQuoted) ||
			(requiresQuoted && !m.isQuoted)
		) {
			await m.reply(
				`📝 Usage:\n\`\`\`${this.formatUsage(plugin.usage, m)}\`\`\``
			);
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

		const limitKey = `${this.getStableSenderKey(m)}:${plugin.name}`;
		const usageCount = (this.usageLimits.get(limitKey) || 0) + 1;

		if (usageCount > plugin.dailyLimit) {
			const resetTime = new Date(
				new Date().setHours(24, 0, 0, 0)
			).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
			await m.reply(
				`Daily limit reached! (${plugin.dailyLimit}/${plugin.dailyLimit})\nResets in ${resetTime}`
			);
			if (plugin.react) {
				await m.react("🚫");
			}
			return true;
		}

		this.usageLimits.set(limitKey, usageCount);
		return false;
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
		const params = {
			sock,
			m,
			text: m.text,
			args: m.args,
			plugins: this.plugins,
			command: m.command,
			prefix: m.prefix,
			isOwner: m.isOwner,
			groupMetadata: m.metadata || {},
			participants: m.metadata?.participants || [],
			isAdmin: !!m.isAdmin,
			isBotAdmin: !!m.isBotAdmin,
			api,
			db,
			store: this.store,
			pluginManager: this,
		};

		try {
			print.info(
				`⚡ Executing: ${plugin.name} by ${m.pushName} [${m.senderPn || m.sender}]`
			);

			if (plugin.execute.length === 1) {
				await plugin.execute(m);
			} else {
				const { m: _m, ...rest } = params;
				await plugin.execute(_m, rest);
			}

			if (plugin.cooldown > 0) {
				this.cooldowns.set(
					`${this.getStableSenderKey(m)}:${plugin.name}`,
					true,
					plugin.cooldown
				);
			}

			if (plugin.react) {
				await m.react("✅");
			}
			print.info(
				`✓ Executed ${plugin.name} in ${Date.now() - startTime}ms`
			);
		} catch (error) {
			print.error(`⚠ Plugin ${plugin.name} failed:`, error);
			const errorMessage = plugin.failed
				.replace("%command", m.prefix + m.command)
				.replace("%error", error.message || "Internal error");
			await m.reply(errorMessage);
			if (plugin.react) {
				await m.react("❌");
			}
		}
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
					await (plugin.after.length === 1
						? plugin.after(m)
						: plugin.after(m, params));
				} catch (err) {
					print.error(
						`Error in after() of plugin "${plugin.name}":`,
						err
					);
				}
			}
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
					if (
						!filename ||
						!filename.endsWith(".js") ||
						filename.startsWith("_")
					) {
						return;
					}

					if (this.reloadDebounces.has(filename)) {
						clearTimeout(this.reloadDebounces.get(filename));
					}

					const timeout = setTimeout(async () => {
						this.reloadDebounces.delete(filename);
						await this.reloadSinglePlugin(filename, pluginsDir);
					}, 300);

					this.reloadDebounces.set(filename, timeout);
				}
			);

			watcher.on("error", (error) =>
				print.error("Error in watch:", error)
			);
		} catch (error) {
			print.error("Failed to start watching plugin directory:", error);
		}
	}

	async reloadSinglePlugin(filename, pluginsDir) {
		const absolutePath = join(pluginsDir, filename);
		const pluginURL = pathToFileURL(absolutePath).href;

		try {
			print.info(`🔃 Hot reloading specific plugin: ${filename}`);

			const module = await import(`${pluginURL}?update=${Date.now()}`);
			const newPlugin = module.default;

			if (!this.validatePlugin(newPlugin, filename)) {
				return;
			}
			this.configurePluginDefaults(newPlugin);
			newPlugin.filePath = absolutePath;

			const existingIndex = this.plugins.findIndex(
				(p) => p.filePath === absolutePath
			);

			if (existingIndex !== -1) {
				const oldPlugin = this.plugins[existingIndex];
				if (oldPlugin.name) {
					this.scheduler.stopTask(oldPlugin.name);
				}
				this.plugins[existingIndex] = newPlugin;
				print.info(`Successfully updated plugin: ${newPlugin.name}`);
			} else {
				this.plugins.push(newPlugin);
				print.info(`Successfully added new plugin: ${newPlugin.name}`);
			}

			await this.scheduler.applyPeriodicSettingsFromDB([newPlugin]);

			if (
				newPlugin.periodic?.enabled &&
				newPlugin.periodic.type === "interval" &&
				typeof newPlugin.periodic.run === "function"
			) {
				this.scheduler.startTask(newPlugin);
			}

			setAllCommands(this.getAllCommands());
		} catch (error) {
			print.error(`Failed to hot-reload ${filename}:`, error);
		}
	}

	/**
	 * Only periodic with type: 'interval' is scheduled here.
	 * Periodic with type: 'message' is called in message handler.
	 */
	scheduleAllPeriodicTasks(sock) {
		this.scheduler.scheduleAll(sock, this.plugins);
	}

	async runPeriodicMessagePlugins(m, sock) {
		await this.scheduler.runMessageTasks(m, sock, this.plugins);
	}
}

export default PluginManager;
