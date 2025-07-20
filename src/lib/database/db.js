import { MONGO_CONFIG } from "#config/index";
import { MongoClient } from "mongodb";

let mongoClient = null;

export async function getMongoClient() {
	if (mongoClient && mongoClient.topology?.isConnected()) {
		return mongoClient;
	}
	mongoClient = new MongoClient(MONGO_CONFIG.uri);
	await mongoClient.connect();
	return mongoClient;
}

export async function getCollection(collectionName, dbName) {
	const client = await getMongoClient();
	const db = client.db(dbName || process.env.BOT_SESSION_NAME || "sessions");
	return db.collection(collectionName);
}
