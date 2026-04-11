import { MYSQL_CONFIG } from "#config/index";
import { useMongoDbAuthState } from "#lib/auth/mongodb";
import logger from "#lib/logger";
import { useMultiFileAuthState } from "baileys";
import useMySQLAuthState from "mysql-baileys";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * Manages auth state initialization for supported backends.
 */
class AuthStateManager {
	/**
	 * Available auth backends.
	 *
	 * @type {{MONGODB: string, MYSQL: string, LOCAL: string}}
	 */
	static AUTH_BACKENDS = {
		MONGODB: "mongodb",
		MYSQL: "mysql",
		LOCAL: "local",
	};

	/**
	 * Create auth state manager instance.
	 *
	 * @param {string} sessionName - Unique name for the session.
	 */
	constructor(sessionName) {
		/**
		 * Unique name for the current session.
		 *
		 * @type {string}
		 */
		this.sessionName = sessionName;
	}

	/**
	 * Resolve which backend should be used based on environment variables.
	 *
	 * @returns {string} Selected backend name.
	 */
	resolveBackend() {
		const authStore = process.env.AUTH_STORE?.toLowerCase();
		const useMongo = process.env.USE_MONGO_AUTH === "true";

		if (useMongo || authStore === AuthStateManager.AUTH_BACKENDS.MONGODB) {
			return AuthStateManager.AUTH_BACKENDS.MONGODB;
		}

		if (authStore === AuthStateManager.AUTH_BACKENDS.MYSQL) {
			return AuthStateManager.AUTH_BACKENDS.MYSQL;
		}

		return AuthStateManager.AUTH_BACKENDS.LOCAL;
	}

	/**
	 * Get auth state implementation based on the configured backend.
	 *
	 * @returns {Promise<{state: any, saveCreds: Function, removeCreds: Function}>}
	 */
	async getAuthState() {
		const backend = this.resolveBackend();

		logger.info(`Initializing auth backend: ${backend}`);

		switch (backend) {
			case AuthStateManager.AUTH_BACKENDS.MONGODB:
				return this.getMongoAuthState();

			case AuthStateManager.AUTH_BACKENDS.MYSQL:
				return this.getMySQLAuthState();

			case AuthStateManager.AUTH_BACKENDS.LOCAL:
			default:
				return this.getLocalAuthState();
		}
	}

	/**
	 * Initialize MongoDB auth state.
	 *
	 * @returns {Promise<{state: any, saveCreds: Function, removeCreds: Function}>}
	 */
	async getMongoAuthState() {
		const mongoUrl = process.env.MONGO_URI;

		if (!mongoUrl) {
			throw new Error("MONGO_URI is required when using MongoDB auth.");
		}

		const { state, saveCreds, removeCreds } = await useMongoDbAuthState(
			mongoUrl,
			this.sessionName
		);

		return { state, saveCreds, removeCreds };
	}

	/**
	 * Initialize MySQL auth state.
	 *
	 * @returns {Promise<{state: any, saveCreds: Function, removeCreds: Function}>}
	 */
	async getMySQLAuthState() {
		const { state, saveCreds, removeCreds } = await useMySQLAuthState({
			...MYSQL_CONFIG,
			session: this.sessionName,
		});

		return { state, saveCreds, removeCreds };
	}

	/**
	 * Initialize local file-based auth state.
	 *
	 * @returns {Promise<{state: any, saveCreds: Function, removeCreds: Function}>}
	 */
	async getLocalAuthState() {
		const base = process.env.LOCAL_AUTH_PATH || "auth_info_baileys";
		const authPath = join(base, this.sessionName);

		const { state, saveCreds } = await useMultiFileAuthState(authPath);

		/**
		 * Remove all local auth credential files for the current session.
		 *
		 * @returns {Promise<void>}
		 */
		const removeCreds = async () => {
			try {
				const files = await readdir(authPath);
				await Promise.all(
					files.map((file) => unlink(join(authPath, file)))
				);
				logger.info(`All auth files removed from: ${authPath}`);
			} catch (error) {
				if (error.code !== "ENOENT") {
					logger.error("Failed to remove local auth files:", error);
				}
			}
		};

		return { state, saveCreds, removeCreds };
	}
}

/**
 * Get authentication state for a session.
 * Keeps backward compatibility with the previous function-based API.
 *
 * @param {string} sessionName - Unique name for the session.
 * @returns {Promise<{state: any, saveCreds: Function, removeCreds: Function}>}
 */
export default async function getAuthState(sessionName) {
	const manager = new AuthStateManager(sessionName);
	return manager.getAuthState();
}

export { AuthStateManager };
