import { getCollection } from "#lib/database/db";

const COLLECTION = "groups";

export default class GroupModel {
	/**
	 * Get a group by JID, auto-create if not exists (schema compliant).
	 * @param {string} jid
	 * @returns {Promise<Object>}
	 */
	static async getGroup(jid) {
		const col = await getCollection(COLLECTION);
		let group = await col.findOne({ _id: jid });
		if (!group) {
			group = {
				_id: jid,
				name: "",
				banned: false,
			};
			await col.insertOne(group);
		}
		return group;
	}

	/**
	 * Set group banned/unbanned.
	 * @param {string} jid
	 * @param {boolean} banned
	 */
	static async setBanned(jid, banned = true) {
		const col = await getCollection(COLLECTION);
		await col.updateOne(
			{ _id: jid },
			{ $set: { banned } },
			{ upsert: true }
		);
		return this.getGroup(jid);
	}

	/**
	 * Update group name.
	 * @param {string} jid
	 * @param {string} name
	 */
	static async setName(jid, name) {
		const col = await getCollection(COLLECTION);
		await col.updateOne({ _id: jid }, { $set: { name } }, { upsert: true });
		return this.getGroup(jid);
	}
}
