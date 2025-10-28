import { MYSQL_CONFIG } from "#config/index";
import { useMongoDbAuthState } from "#lib/auth/mongodb";
import logger from "#lib/logger";
import { useMultiFileAuthState } from "baileys";
import useMySQLAuthState from "mysql-baileys";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const AUTH_BACKENDS = {
	MONGODB: "mongodb",
	MYSQL: "mysql",
	LOCAL: "local",
};

/**
 * Handles authentication state for different backends (MongoDB, MySQL, Local File).
 *
 * @param {string} sessionName - Unique name for the session.
 * @returns {Promise<{state: any, saveCreds: Function, removeCreds: Function}>}
 */
export default async function getAuthState(sessionName) {
	const authStore = process.env.AUTH_STORE?.toLowerCase();
	const useMongo = process.env.USE_MONGO_AUTH === "true";

	let backend;
	if (useMongo || authStore === AUTH_BACKENDS.MONGODB) {
		backend = AUTH_BACKENDS.MONGODB;
	} else if (authStore === AUTH_BACKENDS.MYSQL) {
		backend = AUTH_BACKENDS.MYSQL;
	} else {
		backend = AUTH_BACKENDS.LOCAL;
	}

	logger.info(`Initializing auth backend: ${backend}`);

	switch (backend) {
		case AUTH_BACKENDS.MONGODB: {
			const mongoUrl = process.env.MONGO_URI;
			if (!mongoUrl) {
				throw new Error(
					"MONGO_URI is required when using MongoDB auth."
				);
			}
			const { state, saveCreds, removeCreds } = await useMongoDbAuthState(
				mongoUrl,
				{ session: sessionName }
			);
			return { state, saveCreds, removeCreds };
		}

		case AUTH_BACKENDS.MYSQL: {
			const { state, saveCreds, removeCreds } = await useMySQLAuthState({
				...MYSQL_CONFIG,
				session: sessionName,
			});
			return { state, saveCreds, removeCreds };
		}

		case AUTH_BACKENDS.LOCAL:
		default: {
			const authPath = process.env.LOCAL_AUTH_PATH || "auth_info_baileys";
			const { state, saveCreds } = await useMultiFileAuthState(authPath);

			const removeCreds = async () => {
				try {
					const files = await readdir(authPath);
					await Promise.all(
						files.map((file) => unlink(join(authPath, file)))
					);
					logger.info(`All auth files removed from: ${authPath}`);
				} catch (error) {
					if (error.code !== "ENOENT") {
						logger.error(
							"Failed to remove local auth files:",
							error
						);
					}
				}
			};

			return { state, saveCreds, removeCreds };
		}
	}
}
