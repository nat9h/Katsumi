import { SettingsModel } from "../lib/database/index.js";
import { getPrefix } from "../lib/prefix.js";
import { print } from "../lib/print.js";
import serialize from "../lib/serialize.js";

/**
 * Class for processing incoming messages and routing them to the PluginManager.
 */
class Message {
	/**
	 * @param {import('../lib/plugins.js').default} pluginManager - The plugin manager instance.
	 * @param {string[]} ownerJids - An array of owner JIDs (raw numbers).
	 * @param {string[]} prefixes - An array of bot prefixes.
	 * @param {import('lru-cache')} groupMetadataCache - Cache for group metadata.
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

		const settings = await SettingsModel.getSettings();

		for (const msg of messages) {
			try {
				if (!msg.message) {
					continue;
				}

				if (!msg.messageTimestamp) {
					msg.messageTimestamp = Date.now() / 1000;
				}

				const m = await serialize(sock, msg, this.store);

				this.store.saveMessage(m.from, msg);

				if (!m || !m.body) {
					continue;
				}

				const { prefix, isCommand, command, args, text } = getPrefix(
					m.body,
					m
				);

				m.prefix = prefix;
				m.isCommand = isCommand;
				m.command = command;
				m.args = args;
				m.text = text;

				await print(m, sock);

				if (settings.self && !m.isOwner) {
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
