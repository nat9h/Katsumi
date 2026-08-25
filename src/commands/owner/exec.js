/**
 * @fileoverview Exec command — runs a shell command on the host.
 * Owner-only. Uses custom prefix "$".
 * @module commands/owner/exec
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { CommandBuilder } from "#libs/structures/CommandBuilder";
import { sanitizeSecrets } from "#libs/utils/format";

const execAsync = promisify(exec);

export default new CommandBuilder()
    .setName("exec")
    .setAliases("sh")
    .setPrefix("$")
    .setDescription("Run a shell command")
    .setUsage("$ <command>")
    .setExample("$ ls")
    .setGuard("owner")
    .setHandler(async (interaction) => {
        const input = interaction.rawBody || interaction.body;
        if (!input) {
            return interaction.reply(interaction.usage());
        }

        try {
            const { stdout, stderr } = await execAsync(input, {
                shell:
                    process.platform === "win32" ? "powershell.exe" : "/bin/sh",
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
            });
            const out = (stdout || stderr || "(no output)").trim();
            return interaction.reply(sanitizeSecrets(out));
        } catch (err) {
            const out = (
                err.stdout ||
                err.stderr ||
                err.message ||
                String(err)
            ).trim();
            return interaction.reply(sanitizeSecrets(out));
        }
    });
