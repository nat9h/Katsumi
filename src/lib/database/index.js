const useLocal = process.env.USE_MONGO !== "true";

let SettingsModel, UserModel, GroupModel, SessionModel;

if (useLocal) {
	const localDB = (await import("./local.js")).default;

	// Optional: Enable autosave
	// localDB.savePeriodically();

	SettingsModel = {
		async getSettings() {
			await localDB.initialize();
			return localDB.settings.get("bot") || {};
		},
		async setSettings(data) {
			await localDB.initialize();
			localDB.settings.set("bot", data);
			localDB.save();
		},
		async updateSettings(update) {
			await localDB.initialize();
			const current = localDB.settings.get("bot") || {};
			localDB.settings.set("bot", { ...current, ...update });
			localDB.save();
		},
	};

	UserModel = {
		async getAllUsers() {
			await localDB.initialize();
			if (typeof localDB.users.values === "function") {
				return Array.from(localDB.users.values());
			}
			return Object.values(localDB.users);
		},
		async getUser(id) {
			await localDB.initialize();
			return localDB.users.get(id) || {};
		},
		async setUser(id, data) {
			await localDB.initialize();
			localDB.users.set(id, data);
			localDB.save();
		},
		async setName(id, name) {
			const user = await this.getUser(id);
			user.name = name;
			await this.setUser(id, user);
		},
		async setBanned(id, banned = false) {
			const user = await this.getUser(id);
			user.banned = banned;
			await this.setUser(id, user);
		},
		async setPremium(id, premium = false, expired = 0) {
			const user = await this.getUser(id);
			user.premium = premium;
			user.premium_expired = expired;
			await this.setUser(id, user);
		},
		async setLimit(id, limit = 0) {
			const user = await this.getUser(id);
			user.limit = limit;
			await this.setUser(id, user);
		},
	};

	GroupModel = {
		async getGroup(id) {
			await localDB.initialize();
			return localDB.groups.get(id) || {};
		},
		async setGroup(id, data) {
			await localDB.initialize();
			localDB.groups.set(id, data);
			localDB.save();
		},
		async setName(id, name) {
			const group = await this.getGroup(id);
			group.name = name;
			await this.setGroup(id, group);
		},
		async setBanned(id, banned = true) {
			const group = await this.getGroup(id);
			group.banned = banned;
			await this.setGroup(id, group);
		},
	};
} else {
	SettingsModel = (await import("./models/settings.js")).default;
	UserModel = (await import("./models/user.js")).default;
	GroupModel = (await import("./models/group.js")).default;
	SessionModel = (await import("./models/session.js")).default;
}

export { SettingsModel, UserModel, GroupModel, SessionModel };
