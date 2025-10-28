<div align="center">
  <h1>Katsumi</h1>
  <p>
<a href="https://i.pinimg.com/736x/82/5c/b2/825cb2782b4ec2709b93bc8e128ba5ac.jpg">
<img src="https://i.pinimg.com/736x/82/5c/b2/825cb2782b4ec2709b93bc8e128ba5ac.jpg" alt="Katsumi"/>
</a>
  </p>
  <p>Fast, modular WhatsApp bot built on <a href="https://github.com/WhiskeySockets/Baileys">Baileys</a>. Plugin-system. Multi‑database.</p>
  <p>
    <a href="https://github.com/nat9h/Katsumi"><img alt="Stars" src="https://img.shields.io/github/stars/nat9h/Katsumi?style=flat&logo=github"></a>
    <a href="https://github.com/nat9h/Katsumi/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/nat9h/Katsumi"></a>
    <a href="https://github.com/nat9h/Katsumi/issues"><img alt="Issues" src="https://img.shields.io/github/issues/nat9h/Katsumi"></a>
    <a href="https://github.com/nat9h/Katsumi"><img alt="Last Commit" src="https://img.shields.io/github/last-commit/nat9h/Katsumi"></a>
    <a href="https://github.com/nat9h/Katsumi"><img alt="Repo Size" src="https://img.shields.io/github/repo-size/nat9h/Katsumi"></a>
  </p>
  <p>
    <a href="https://github.com/nat9h/Katsumi/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-informational"></a>
    <img alt="PRs Welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen">
    <a href="https://dsc.gg/natsumiworld"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white"></a>
  </p>
</div>

---

## Table of Contents

- [Overview](#overview)
- [Why Katsumi?](#why-katsumi)
- [Feature Matrix](#feature-matrix)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Create a Plugin](#create-a-plugin)
- [Scripts](#scripts)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

Katsumi is a lean WhatsApp bot framework built on Baileys. Drop a plugin file in `src/plugins/` and it becomes a command. Configure via `.env`, choose MySQL, MongoDB, or a JSON store, and deploy with PM2 or Docker.

## Why Katsumi?

- Focused, minimal core
- Plugin‑first design
- MySQL / MongoDB / JSON storage
- Clean developer workflow (ESLint, Prettier, PM2)

## Feature Matrix

| Area            | Capability                       | Status |
| --------------- | -------------------------------- | :----: |
| Core            | Baileys socket + message router  |   ✅   |
| Plugins         | File‑based, auto‑loaded commands |   ✅   |
| Storage         | MySQL / MongoDB / JSON           |   ✅   |
| Config          | Centralized `.env`               |   ✅   |
| DX              | ESLint, Prettier, scripts        |   ✅   |
| Process Manager | PM2 `ecosystem.config.cjs`       |   ✅   |
| Docker          | Example snippet (below)          |   ▶️   |

## Quick Start

```bash
git clone https://github.com/nat9h/Katsumi.git
cd Katsumi
npm install
cp .env.example .env
```

Edit `.env`, then run:

```bash
npm run dev   # development
npm start     # production
npm run pm2   # PM2 process
```

On first run, scan the QR code or Pairing code with WhatsApp.

## Configuration

| Variable         | Description                          | Example / Default                  |
| ---------------- | ------------------------------------ | ---------------------------------- |
| MYSQL_HOST       | MySQL host                           | localhost                          |
| MYSQL_PORT       | MySQL port                           | 3306                               |
| MYSQL_USER       | MySQL user                           | root                               |
| MYSQL_PASSWORD   | MySQL password                       | password                           |
| MYSQL_DATABASE   | MySQL database name                  | baileys                            |
| USE_MONGO        | Use MongoDB for storage (true/false) | false                              |
| MONGO_URI        | MongoDB connection string            | mongodb://localhost:27017/database |
| BOT_SESSION_NAME | Session storage identifier           | session                            |
| BOT_PREFIXES     | Comma‑separated command prefixes     | !,.,?                              |

Notes:

- When `USE_MONGO=true`, ensure `MONGO_URI` is reachable.
- If neither MySQL or MongoDB is enabled, Katsumi falls back to a JSON store.

**Docker (optional)**

```dockerfile
# Dockerfile (example)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["npm","start"]
```

```bash
# Build & run
docker build -t katsumi .
docker run --env-file .env --name katsumi --restart unless-stopped katsumi
```

## Project Structure

```
Katsumi/
├───src
│   ├───config
│   ├───core
│   ├───lib
│   │   ├───auth
│   │   ├───clonebot
│   │   ├───database
│   │   │   └───models
│   │   ├───schema
│   │   └───scraper
│   ├───plugins
│   └───utils
│       └───API
├─ ecosystem.config.cjs
├─ eslint.config.mjs
├─ .env.example
├─ package.json
└─ README.md
```

## Create a Plugin

Create `src/plugins/ping.js`:

```js
import os from "os";
import { performance } from "perf_hooks";

export default {
	name: "ping",
	description: "Show latency and host info",
	command: ["ping", "p"],
	permissions: "all", // all | admin | owner
	category: "info",
	cooldown: 0,
	async execute(m) {
		const t0 = performance.now();
		const total = (os.totalmem() / 1024 ** 3).toFixed(2);
		const free = (os.freemem() / 1024 ** 3).toFixed(2);
		await m.reply(
			`PONG
` +
				`Latency: ${(performance.now() - t0).toFixed(2)}ms
` +
				`CPU: ${os.cpus().length} cores
` +
				`RAM: ${free} / ${total} GB`
		);
	},
};
```

### Plugin Options

| Option      | Description                   | Example                 |
| ----------- | ----------------------------- | ----------------------- |
| command     | Triggers                      | \["ping", "p"]          |
| permissions | Access level                  | "all", "admin", "owner" |
| category    | Help grouping                 | "info"                  |
| cooldown    | Cooldown in seconds           | 0                       |
| group       | Group chats only (optional)   | true / false            |
| private     | Private chats only (optional) | true / false            |

## Scripts

```bash
npm run dev       # watch mode
npm run lint      # eslint
npm run prettier  # format
```

## Troubleshooting

- No QR: widen the terminal and check network; pairing code mode is supported.
- MySQL auth errors: verify host/user/password and database.
- Mongo errors: verify `MONGO_URI` and that `USE_MONGO=true`.
- Session issues: change `BOT_SESSION_NAME` and re‑login.

## Contributing

Fork, create a feature branch, run lint, open a pull request with a clear description.

## License

MIT. See [LICENSE](./LICENSE).
