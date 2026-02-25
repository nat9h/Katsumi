import * as db from "#lib/database/index";
import { getPrefix } from "#lib/prefix";
import { print } from "#lib/print";
import serialize from "#lib/serialize";

/**
 * Class for processing incoming messages and routing them to the PluginManager.
 */
class Message {
	/**
	 * @param {import('../lib/plugins.js').default} pluginManager - The plugin manager instance.
	 * @param {string[]} ownerJids - An array of owner JIDs (raw numbers).
	 * @param {string[]} prefixes - An array of bot prefixes.
	 * @param {import('@cacheable/node-cache')} groupMetadataCache - Cache for group metadata.
	 * @param {import('../lib/store.js')} store - Store instance.
	 */
	constructor(pluginManager, ownerJids, prefixes, groupMetadataCache, store) {
		this.pluginManager = pluginManager;
		this.ownerJids = ownerJids;
		this.prefixes = prefixes;
		this.groupMetadataCache = groupMetadataCache;
		this.store = store;
	}

	/**
	 * Handle 'messages.upsert' event from Baileys.
	 * @param {import('baileys').WASocket} sock - Baileys socket object.
	 * @param {{ messages: import('baileys').proto.IWebMessageInfo[], type: string }} data - Message data from the event.
	 */
	async process(sock, { messages, type }) {
		if (type !== "notify") {
			return;
		}

		let settings = {};
		try {
			if (!db?.SettingsModel?.getSettings) {
				console.warn(
					"[DB] SettingsModel not ready; using empty settings."
				);
			} else {
				settings = await db.SettingsModel.getSettings();
			}
		} catch (err) {
			console.error("[DB] Failed to load settings:", err);
			settings = {};
		}

		for (const msg of messages) {
			try {
				if (!msg?.message) {
					continue;
				}

				if (!msg.messageTimestamp) {
					msg.messageTimestamp = Date.now() / 1000;
				}

				const m = await serialize(sock, msg, this.store);

				if (!m) {
					continue;
				}

				if (m.from) {
					this.store.saveMessage(m.from, msg);
				}

				const userId = m.senderPn || m.sender;
				if (db?.UserModel?.setUser && userId) {
					await db.UserModel.setUser(userId, { name: m.pushName });
				}

				await print(m, sock);

				if (!m.body) {
					continue;
				}

				const { prefix, isCommand, command, args, text } = getPrefix(
					m.body,
					m
				);

				let groups = {};
				try {
					if (!db?.GroupModel?.getGroup) {
						console.warn(
							"[DB] GroupModel not ready; using empty groups."
						);
					} else {
						groups = await db.GroupModel.getGroup(m.from);
					}
				} catch (err) {
					console.error("[DB] Failed to load groups:", err);
					groups = {};
				}

				m.prefix = prefix;
				m.isCommand = isCommand;
				m.command = command;
				m.args = args;
				m.text = text;

				if (settings.self && !m.isOwner && !m.isClonebot) {
					continue;
				}
				if (m.isGroup && groups?.banned && !m.isOwner) {
					continue;
				}
				if (settings.groupOnly && !m.isGroup && !m.isOwner) {
					continue;
				}
				if (settings.privateChatOnly && m.isGroup && !m.isOwner) {
					continue;
				}

				if (m.isCommand) {
					await this.pluginManager.enqueueCommand(sock, m);
				}

				await this.pluginManager.runPeriodicMessagePlugins(m, sock);
				await this.pluginManager.handleAfterPlugins(m, sock);
			} catch (error) {
				console.error("Error processing message:", error);
			}
		}
	}
}

export default Message;
