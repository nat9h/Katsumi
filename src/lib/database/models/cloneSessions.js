import { getCollection } from "#lib/database/db";

const COLLECTION = "clonesessions";

export class CloneSessionModel {
	static async add(sessionName, phone) {
		const col = await getCollection(COLLECTION);
		await col.updateOne(
			{ _id: sessionName },
			{
				$set: {
					phone,
					connected: true,
					createdAt: Date.now(),
				},
			},
			{ upsert: true }
		);
		return this.get(sessionName);
	}
	static async setConnected(sessionName, connected) {
		const col = await getCollection(COLLECTION);
		await col.updateOne({ _id: sessionName }, { $set: { connected } });
	}
	static async remove(sessionName) {
		const col = await getCollection(COLLECTION);
		await col.deleteOne({ _id: sessionName });
	}
	static async list() {
		const col = await getCollection(COLLECTION);
		return col.find({}).toArray();
	}
	static async get(sessionName) {
		const col = await getCollection(COLLECTION);
		return col.findOne({ _id: sessionName });
	}
}
