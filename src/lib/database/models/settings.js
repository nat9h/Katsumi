import { getCollection } from "#lib/database/db";

const COLLECTION = "settings";

export class SettingsModel {
	/**
	 * Get bot global settings (schema compliant).
	 * @returns {Promise<Object>}
	 */
	static async getSettings() {
		const col = await getCollection(COLLECTION);
		let doc = await col.findOne({ _id: "settings" });
		if (!doc) {
			doc = {
				_id: "settings",
				self: false,
				groupOnly: false,
				privateChatOnly: false,
			};
			await col.insertOne(doc);
		}
		return doc;
	}

	/**
	 * Update bot global settings.
	 * @param {object} newSettings
	 */
	static async updateSettings(newSettings) {
		const col = await getCollection(COLLECTION);
		return col.updateOne(
			{ _id: "settings" },
			{ $set: newSettings },
			{ upsert: true }
		);
	}
}
