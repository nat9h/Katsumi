<div align="center">

<h1>Katsumi</h1>

<img src="./assets/banner.gif" width="600" height="240" alt="Katsumi"/>

Modular WhatsApp bot framework built on [Baileys v7](https://github.com/WhiskeySockets/Baileys).

[![Node.js](https://img.shields.io/badge/node-20+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Baileys](https://img.shields.io/badge/baileys-v7-25D366?style=flat-square&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![SQLite](https://img.shields.io/badge/sqlite-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License](https://img.shields.io/github/license/nat9h/Katsumi?style=flat-square&color=blue)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/nat9h/Katsumi?style=flat-square&logo=github)](https://github.com/nat9h/Katsumi/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/nat9h/Katsumi?style=flat-square&logo=github)](https://github.com/nat9h/Katsumi/network)
[![GitHub issues](https://img.shields.io/github/issues/nat9h/Katsumi?style=flat-square&logo=github)](https://github.com/nat9h/Katsumi/issues)
[![Last commit](https://img.shields.io/github/last-commit/nat9h/Katsumi?style=flat-square)](https://github.com/nat9h/Katsumi/commits)
[![Version](https://img.shields.io/badge/version-1.0.6-orange?style=flat-square)](package.json)

**[Getting Started](#getting-started) · [Commands](#commands) · [Guide](#guide) · [Config](#configuration)**

</div>

---

## Highlights

- **Plugin system** — drop a file, bot picks it up. Hot-reload included.
- **Guard-based access** — owner, group, admin, private. Combine as needed.
- **Multi-device clones** — run multiple bot instances from one codebase.
- **Rate limiting** — per-command cooldowns out of the box.
- **SQLite storage** — fast, zero-config persistence.

---

## Getting Started

```bash
git clone https://github.com/nat9h/Katsumi.git
cd Katsumi
npm install
cp .env.example .env
```

Edit `.env` with your number, then:

```bash
npm run dev       # development (watch mode)
npm run pm2       # production
npm start         # manual
```

> Requires **Node.js 20+**, **FFmpeg**, and **yt-dlp**.

---

## Commands

| Category | Commands |
|----------|----------|
| Converter | `sticker` `toaudio` `toimage` `tovideo` `album` |
| Downloader | `youtube` `spotify` |
| Group | `antilink` `welcome` `tagall` `kick` `add` `pin` `delete` `totalchat` |
| Info | `menu` `ping` `remind` `stats` |
| Owner | `eval` `exec` `clone` `prefix` `reload` `getplugin` `savefile` `delfile` `join` `out` `set` |
| Tools | `fetch` `getpp` `quoted` `unview` |

---

## Creating Commands

Create a file in `src/commands/<category>/`:

```js
import { CommandBuilder } from "#structures/CommandBuilder";

export default new CommandBuilder()
    .setName("hello")
    .setAliases("hi", "hey")
    .setDescription("Greet the bot")
    .setGuard("group")
    .setRateLimit(60_000, 3)
    .setUsage("{prefix}{name}")
    .setExample("{prefix}hello")
    .setHandler(async (interaction) => {
        await interaction.reply("Hello!");
    })
    .build();
```

That's it. Auto-loaded on startup, or use `reload` to pick up changes live.

### Guards

```js
.setGuard("owner")            // bot owner only
.setGuard("group")            // group chats only
.setGuard("admin")            // group admins only
.setGuard("private")          // DMs only
.setGuard("group", "admin")   // combine them
```

---

## Configuration

```env
LOGIN_METHOD=pairing        # "qr" or "pairing"
PAIRING_NUMBER=62xxx
DB_TYPE=sqlite
DB_PATH=./data/bot.db
PREFIX=!,.,?
OWNER_JID=62xxx
OWNER_LID=62xxx@lid
```

Full reference in [`.env.example`](.env.example).

---

## Structure

```
src/
├── app.js                  # entry point
├── commands/               # auto-loaded plugins
│   ├── converter/
│   ├── downloader/
│   ├── group/
│   ├── info/
│   ├── owner/
│   └── tools/
├── handlers/
│   ├── Client.js           # socket + event binding
│   └── core/               # connection, message, group
└── libs/
    ├── database/           # better-sqlite3
    ├── middleware/          # message pipeline
    ├── services/           # clone, yt-dlp
    ├── structures/         # CommandBuilder, Interaction, Guards
    └── utils/              # cache, format, log, plugin, queue
```

---

## Guide

### Interaction API

Every command handler receives an `interaction` object. Here's what you can do with it:

```js
// Basic replies
await interaction.reply("Hello");              // quote the user's message
await interaction.reply("Second");             // auto becomes followUp
await interaction.followUp("Another message"); // quote your last message
await interaction.editReply("Edited text");    // edit your last sent message
await interaction.react("✅");                 // react to user's message

// Typing indicator
await interaction.typing();                    // shows "typing..." (auto-clears 8s)
await interaction.stopTyping();                // manual stop

// Send media
await interaction.reply({
    image: { url: "https://example.com/img.jpg" },
    caption: "Here's an image"
});

await interaction.reply({
    audio: buffer,
    ptt: true                                  // auto-converts to opus
});

await interaction.reply({
    video: buffer,
    fileName: "clip.mp4"
});

// Polls
await interaction.sendPoll("Favorite?", ["Option A", "Option B"], {
    selectableCount: 1
});
```

### Properties

```js
interaction.user        // sender JID (normalized)
interaction.userName    // push name
interaction.chatJid     // chat JID
interaction.isGroup     // boolean
interaction.fromMe      // boolean
interaction.text        // message text (unwrapped)
interaction.url         // first URL in text, or null
interaction.quoted      // quoted message object, or null
interaction.body        // args joined as string
interaction.rawBody     // raw text after command name
interaction.rawArgs     // string[]
interaction.args        // parsed by addOption() definitions
interaction.prefix      // prefix used to invoke
interaction.commandName // command name used
```

### Quoted Messages

```js
if (interaction.quoted) {
    interaction.quoted.text       // text content
    interaction.quoted.sender     // sender JID
    interaction.quoted.message    // raw message object
    interaction.quoted.url        // first URL, or null
    interaction.quoted.isUrl      // boolean
}
```

### Awaiting Replies

```js
await interaction.reply("What's your name?");

try {
    const response = await interaction.awaitReply(
        () => true,   // filter function
        30_000        // timeout ms (default 30s)
    );
    const name = extractText(response.message);
    await interaction.followUp(`Hello, ${name}!`);
} catch {
    await interaction.followUp("Timed out.");
}
```

### Message Collector

For collecting multiple messages:

```js
const collector = interaction.createMessageCollector({
    filter: (msg) => true,
    time: 60_000,
    max: 5
});

collector.on("collect", (msg) => {
    // handle each message
});

collector.on("end", (collected, reason) => {
    // reason: "time" | "max" | "manual"
});

// manual stop
collector.stop();
```

### Pick From List

Built-in numbered list selector:

```js
const groups = await interaction.sock.groupFetchAllParticipating();
const items = Object.values(groups);

const selected = await interaction.pickFromList(items, "Select a group");
if (!selected) return; // cancelled or timeout

await interaction.followUp(`You picked: ${selected.subject}`);
```

### CommandBuilder Options

```js
new CommandBuilder()
    .setName("greet")                    // required
    .setAliases("hi", "hey")            // alternative triggers
    .setDescription("Greet someone")     // shown in menu
    .setNote("Extra info")               // additional note
    .setGuard("group", "admin")          // access control
    .setRateLimit(60_000, 3)             // 3 uses per 60s
    .setReact("👋")                      // auto-react on trigger
    .setHidden(true)                     // hide from menu
    .setDisabled(true)                   // disable entirely
    .setPrefix(">>")                     // custom prefix override
    .setUsage("{prefix}{name} <target>")
    .setExample("{prefix}greet @user")
    .setCooldownMessage("Wait a bit!")
    .addOption("target", "string", "Who to greet")
    .setHandler(async (interaction) => {
        const target = interaction.args.target;
        await interaction.reply(`Hello ${target || "world"}!`);
    })
    .build();
```

### Custom Guards

```js
import { GuardError } from "#structures/CommandBuilder";

function premiumOnly(interaction) {
    const premiumUsers = ["628xxx@s.whatsapp.net"];
    if (!premiumUsers.includes(interaction.user)) {
        throw new GuardError("Premium users only.");
    }
}

new CommandBuilder()
    .setName("exclusive")
    .setGuard(premiumOnly)  // pass function directly
    .setHandler(async (i) => i.reply("Welcome, premium user!"))
    .build();
```

### Accessing Database

```js
// Key-value store (persisted in SQLite)
interaction.db.set("mykey", { count: 1 });
interaction.db.get("mykey");  // { count: 1 }

// Per-chat settings
interaction.db.set(`setting:${interaction.chatJid}`, true);
```

### Accessing Group Metadata

```js
const meta = await interaction.getGroupMeta();
// meta.subject, meta.participants, meta.desc, etc.

const participant = meta.participants.find(p => p.id === someJid);
if (participant?.admin) {
    // is admin
}
```

### Client & Store

```js
interaction.client       // Client instance
interaction.sock         // Baileys WASocket
interaction.store        // DataStore (contacts, groups, chats)
interaction.client.db    // KeyValueStore
```

---

## Import Aliases

```js
import config from "#config";
import { CommandBuilder } from "#structures/CommandBuilder";
import { isOwner } from "#utils/permission";
```

<details>
<summary>Full list</summary>

| Alias | Path |
|-------|------|
| `#config` | `./src/libs/settings/config.js` |
| `#state` | `./src/libs/settings/state.js` |
| `#db` | `./src/libs/database/db.js` |
| `#middleware` | `./src/libs/middleware/index.js` |
| `#structures/*` | `./src/libs/structures/*.js` |
| `#utils/*` | `./src/libs/utils/*/index.js` |
| `#core/*` | `./src/handlers/core/*.js` |
| `#services/*` | `./src/libs/services/*.js` |
| `#storage/*` | `./src/libs/storage/*.js` |

</details>

---

## Stack

[Baileys](https://github.com/WhiskeySockets/Baileys) · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) · [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) · [Axios](https://github.com/axios/axios) · [file-type](https://github.com/sindresorhus/file-type) · [node-webpmux](https://github.com/nicedaycode/node-webpmux) · [Biome](https://biomejs.dev/)

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Watch mode with auto-restart |
| `npm run pm2` | Production via PM2 |
| `npm start` | Single run |
| `npm run lint` | Check issues |
| `npm run lint:fix` | Auto-fix |
| `npm run format` | Format code |

---

<div align="center">

[MIT License](LICENSE)

<a href="https://github.com/nat9h">
  <img src="https://img.shields.io/badge/Natsumi-171515?style=flat-square&logo=github&logoColor=white" alt="Natsumi" />
</a>

<sub>Built with ♥ and mass amounts of caffeine</sub>

</div>
