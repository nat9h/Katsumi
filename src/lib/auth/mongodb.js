import print from "#lib/print";
import { BufferJSON, WAProto, initAuthCreds } from "baileys";
import { MongoClient } from "mongodb";

/**
 * Creates and returns a connection to a MongoDB collection.
 * @param {string | object} mongoUri - The MongoDB URI string or a configuration object.
 * @param {string} [database=process.env.BOT_SESSION_NAME || 'sessions'] - The name of the database to use.
 * @param {string} [collectionName=process.env.MONGO_AUTH_COLLECTION || 'auth'] - The name of the collection to use.
 * @returns {Promise<import('mongodb').Collection>} A promise that resolves with the MongoDB collection object.
 * @throws {Error} Throws an error if the MongoDB URI is invalid or the connection fails.
 */
const connectToMongoDB = async (
	mongoUri,
	database = process.env.BOT_SESSION_NAME || "sessions",
	collectionName = process.env.MONGO_AUTH_COLLECTION || "auth"
) => {
	if (!mongoUri) {
		throw new Error(
			"Invalid MongoDB URI. Please provide a URI string or a configuration object."
		);
	}

	let uri;
	if (typeof mongoUri === "string") {
		uri = mongoUri;
	} else {
		const { isSrv, username, password, host, port } = mongoUri;
		uri = `mongodb${isSrv ? "+srv" : ""}://${username}:${password}@${host}:${port}`;
	}

	print.info(`Connecting to MongoDB with URI: ${uri}`);

	try {
		const client = new MongoClient(uri);
		await client.connect();
		const db = client.db(database);
		const collection = db.collection(collectionName);
		print.info("Successfully connected to MongoDB.");
		return collection;
	} catch (error) {
		print.error("Failed to connect to MongoDB:", error);
		throw new Error("Connection to MongoDB failed.");
	}
};

/**
 * Uses MongoDB as a backend to store the Baileys authentication state.
 * @param {string | object} mongoUri - The MongoDB URI string or a configuration object.
 * @param {string} [identifier="default"] - A unique identifier for this session.
 * @param {string} [database] - The name of the database to use.
 * @returns {Promise<{ state: object, saveCreds: Function, clearAll: Function }>} An object containing the authentication state and functions to manage it.
 * @throws {Error} Throws an error if connecting to the MongoDB collection fails.
 */
export const useMongoDbAuthState = async (
	mongoUri,
	opts = "default",
	database
) => {
	const identifier =
		typeof opts === "string"
			? opts
			: opts?.session || opts?.identifier || "default";

	const collection = await connectToMongoDB(mongoUri, database);

	const fixFileName = (file) =>
		file?.replace(/\//g, "__")?.replace(/:/g, "-") || "";

	const readData = async (fileName) => {
		try {
			const query = { filename: fixFileName(fileName), identifier };
			const data = await collection.findOne(query);
			return data ? JSON.parse(data.datajson, BufferJSON.reviver) : null;
		} catch (error) {
			print.error(`Failed to read data for file: ${fileName}`, error);
			return null;
		}
	};

	const writeData = async (datajson, fileName) => {
		try {
			const query = { filename: fixFileName(fileName), identifier };
			const update = {
				$set: {
					filename: fixFileName(fileName),
					identifier,
					datajson: JSON.stringify(datajson, BufferJSON.replacer),
				},
			};
			await collection.updateOne(query, update, { upsert: true });
		} catch (error) {
			print.error(`Failed to write data for file: ${fileName}`, error);
			throw error;
		}
	};

	const removeData = async (fileName) => {
		const query = { filename: fixFileName(fileName), identifier };
		await collection.deleteOne(query);
	};

	const clearAll = async () => {
		await collection.deleteMany({ identifier });
	};

	const creds = (await readData("creds.json")) || initAuthCreds();

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const data = {};
					await Promise.all(
						ids.map(async (id) => {
							let value = await readData(`${type}-${id}.json`);
							if (type === "app-state-sync-key" && value) {
								value =
									WAProto.Message.AppStateSyncKeyData.fromObject(
										value
									);
							}
							data[id] = value;
						})
					);
					return data;
				},
				set: async (data) => {
					const tasks = [];
					for (const category in data) {
						for (const id in data[category]) {
							const value = data[category][id];
							const file = `${category}-${id}.json`;
							tasks.push(
								value
									? writeData(value, file)
									: removeData(file)
							);
						}
					}
					await Promise.all(tasks);
				},
			},
		},
		saveCreds: () => writeData(creds, "creds.json"),
		removeCreds: clearAll,
	};
};
