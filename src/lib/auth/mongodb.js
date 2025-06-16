import baileys, { BufferJSON, initAuthCreds } from "baileys";
import { MongoClient } from "mongodb";
import print from "../print.js";

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
	identifier = "default",
	database
) => {
	const collection = await connectToMongoDB(mongoUri, database);

	/**
	 * Sanitizes a file name to be safely used in a MongoDB query.
	 * @param {string} file - The file name to sanitize.
	 * @returns {string} The sanitized file name.
	 */
	const fixFileName = (file) =>
		file?.replace(/\//g, "__")?.replace(/:/g, "-") || "";

	/**
	 * Reads data from MongoDB based on the file name.
	 * @param {string} fileName - The file name (key) of the data to read.
	 * @returns {Promise<any>} The parsed data from JSON.
	 */
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

	/**
	 * Writes or updates data in MongoDB.
	 * @param {any} datajson - The data to be written.
	 * @param {string} fileName - The file name (key) for the data.
	 */
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

	/**
	 * Deletes data from MongoDB based on the file name.
	 * @param {string} fileName - The file name (key) of the data to delete.
	 */
	const removeData = async (fileName) => {
		try {
			const query = { filename: fixFileName(fileName), identifier };
			await collection.deleteOne(query);
		} catch (error) {
			print.error(`Failed to delete data for file: ${fileName}`, error);
			throw error;
		}
	};

	/**
	 * Deletes all data associated with this session identifier.
	 */
	const clearAll = async () => {
		try {
			await collection.deleteMany({ identifier });
		} catch (error) {
			print.error(
				`Failed to delete all data for identifier: ${identifier}`,
				error
			);
			throw error;
		}
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
									baileys.proto.Message.AppStateSyncKeyData.fromObject(
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
		clearAll,
	};
};
