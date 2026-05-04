import * as db from "#lib/database/index";
import print from "#lib/print";

/**
 * @typedef {Object} PeriodicConfig
 * @property {boolean} [enabled] - Indicates whether the task is active.
 * @property {"interval" | "message"} [type] - The execution type (time-based or triggered on every message).
 * @property {number} [interval] - The interval duration in milliseconds (applicable only for 'interval' type).
 * @property {Function} run - The core function to be executed by the task.
 */

/**
 * @typedef {Object} Plugin
 * @property {string} name - The name of the plugin.
 * @property {PeriodicConfig} [periodic] - The periodic task configuration attached to the plugin.
 */

/**
 * TaskScheduler manages the scheduling and execution of background tasks.
 * Supports both time-based (interval) and event-based (message) periodic tasks.
 */
class TaskScheduler {
	/**
	 * Initializes the TaskScheduler.
	 *
	 * @param {any} pluginManager - The instance managing bot plugins.
	 */
	constructor(pluginManager) {
		this.pluginManager = pluginManager;
		/** @type {Map<string, NodeJS.Timeout>} */
		this.tasks = new Map();
		this.sock = null;
	}

	/**
	 * Synchronizes the enabled/disabled state of periodic tasks with the database settings.
	 *
	 * @param {Plugin[]} plugins - Array of loaded plugins.
	 * @returns {Promise<void>}
	 */
	async applyPeriodicSettingsFromDB(plugins) {
		try {
			const settings = await db.SettingsModel.getSettings();
			for (const plugin of plugins) {
				if (
					plugin.periodic?.enabled !== undefined &&
					typeof plugin.name === "string"
				) {
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

	/**
	 * Logs the names of currently active periodic and message tasks to the console.
	 *
	 * @param {Plugin[]} plugins - Array of loaded plugins.
	 */
	logActiveTasks(plugins) {
		const interval = [];
		const message = [];

		for (const plugin of plugins) {
			const p = plugin.periodic;
			if (p?.enabled && typeof p.run === "function") {
				if (p.type === "interval") {
					interval.push(plugin.name);
				} else {
					message.push(plugin.name);
				}
			}
		}

		if (interval.length) {
			print.debug(
				`🔁 [Scheduler] Active interval tasks: ${interval.join(", ")}`
			);
		}
		if (message.length) {
			print.debug(
				`🔁 [Scheduler] Active message tasks: ${message.join(", ")}`
			);
		}
	}

	/**
	 * Starts a periodic interval task for a specific plugin.
	 *
	 * @param {Plugin} plugin - The plugin containing the task to start.
	 */
	startTask(plugin) {
		const p = plugin.periodic;
		if (
			!p ||
			p.type !== "interval" ||
			typeof p.run !== "function" ||
			!p.interval
		) {
			return;
		}

		if (this.tasks.has(plugin.name)) {
			return;
		}

		const timer = setInterval(() => {
			p.run(undefined, {
				sock: this.sock,
				pluginManager: this.pluginManager,
			});
		}, p.interval);

		this.tasks.set(plugin.name, timer);
		print.debug(
			`⏰ [Scheduler] Task '${plugin.name}' scheduled every ${p.interval / 1000}s`
		);
	}

	/**
	 * Stops a specific interval task by its plugin name.
	 *
	 * @param {string} name - The name of the plugin/task to stop.
	 */
	stopTask(name) {
		if (this.tasks.has(name)) {
			clearInterval(this.tasks.get(name));
			this.tasks.delete(name);
			print.debug(`🛑 [Scheduler] Task '${name}' stopped`);
		}
	}

	/**
	 * Schedules and starts all enabled interval tasks from the provided plugins.
	 *
	 * @param {any} sock - The Baileys socket instance.
	 * @param {Plugin[]} plugins - Array of loaded plugins.
	 */
	scheduleAll(sock, plugins) {
		this.sock = sock;
		plugins.forEach((plugin) => {
			const p = plugin.periodic;
			if (
				p?.enabled &&
				p.type === "interval" &&
				typeof p.run === "function"
			) {
				this.startTask(plugin);
			}
		});
	}

	/**
	 * Stops all currently running interval tasks and clears the scheduler.
	 */
	stopAll() {
		for (const timer of this.tasks.values()) {
			clearInterval(timer);
		}
		this.tasks.clear();
		print.debug("🛑 All periodic interval tasks stopped.");
	}

	/**
	 * Executes all enabled message-based tasks whenever a new message is received.
	 *
	 * @param {any} m - The serialized message object.
	 * @param {any} sock - The Baileys socket instance.
	 * @param {Plugin[]} plugins - Array of loaded plugins.
	 * @returns {Promise<void>}
	 */
	async runMessageTasks(m, sock, plugins) {
		for (const plugin of plugins) {
			const p = plugin.periodic;
			if (
				p?.enabled &&
				(p.type === "message" || !p.type) &&
				typeof p.run === "function"
			) {
				try {
					await p.run(m, { sock, pluginManager: this.pluginManager });
				} catch (err) {
					print.error(
						`[Scheduler] Error in message task ${plugin.name}:`,
						err
					);
				}
			}
		}
	}
}

export default TaskScheduler;
