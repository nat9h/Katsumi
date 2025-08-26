import { getCollection } from "#lib/database/db";

const COLLECTION = "payloads";

export default class SessionModel {
	static async getSession(userJid) {
		const col = await getCollection(COLLECTION);
		let session = await col.findOne({ _id: userJid });
		if (!session) {
			session = { _id: userJid, history: [], lastActive: Date.now() };
			await col.insertOne(session);
		}
		return session;
	}
	static async saveSession(userJid, history) {
		const col = await getCollection(COLLECTION);
		await col.updateOne(
			{ _id: userJid },
			{ $set: { history, lastActive: Date.now() } },
			{ upsert: true }
		);
	}
	static async clearSession(userJid) {
		const col = await getCollection(COLLECTION);
		await col.deleteOne({ _id: userJid });
	}
	static async expireOldSessions(timeoutMs = 2 * 60 * 1000) {
		const col = await getCollection(COLLECTION);
		const expireBefore = Date.now() - timeoutMs;
		await col.deleteMany({ lastActive: { $lt: expireBefore } });
	}
}
