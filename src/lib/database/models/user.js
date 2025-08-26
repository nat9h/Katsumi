import { getCollection } from "#lib/database/db";

const COLLECTION = "users";

export default class UserModel {
	static async getAllUsers() {
		const col = await getCollection(COLLECTION);
		return col.find({}).toArray();
	}
	/**
	 * Get a user by JID, auto-create if not exists (schema compliant).
	 * @param {string} jid
	 * @returns {Promise<Object>}
	 */
	static async getUser(jid) {
		const col = await getCollection(COLLECTION);
		let user = await col.findOne({ _id: jid });
		if (!user) {
			user = {
				_id: jid,
				name: "",
				limit: 0,
				premium: false,
				premium_expired: 0,
				banned: false,
			};
			await col.insertOne(user);
		}
		return user;
	}

	/**
	 * Set user banned/unbanned.
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
		return this.getUser(jid);
	}

	/**
	 * Update user name.
	 * @param {string} jid
	 * @param {string} name
	 */
	static async setName(jid, name) {
		const col = await getCollection(COLLECTION);
		await col.updateOne({ _id: jid }, { $set: { name } }, { upsert: true });
		return this.getUser(jid);
	}

	/**
	 * Set user premium status and expiry.
	 * @param {string} jid
	 * @param {boolean} premium
	 * @param {number} expired
	 */
	static async setPremium(jid, premium = true, expired = 0) {
		const col = await getCollection(COLLECTION);
		await col.updateOne(
			{ _id: jid },
			{ $set: { premium, premium_expired: expired } },
			{ upsert: true }
		);
		return this.getUser(jid);
	}

	/**
	 * Set user limit.
	 * @param {string} jid
	 * @param {number} limit
	 */
	static async setLimit(jid, limit = 0) {
		const col = await getCollection(COLLECTION);
		await col.updateOne(
			{ _id: jid },
			{ $set: { limit } },
			{ upsert: true }
		);
		return this.getUser(jid);
	}
}
