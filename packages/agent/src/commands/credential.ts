import type { Command } from "commander";
import { addCredential, removeCredential, listCredentials } from "../lib/keystore.js";

export function registerCredentialCommands(program: Command): void {
  const cred = program.command("credential").description("Manage local AI credentials");

  cred
    .command("list")
    .description("List stored credentials")
    .action(async () => {
      const creds = await listCredentials();
      if (!creds.length) {
        console.log("No credentials stored. Use `ysa-agent credential add` to add one.");
        return;
      }
      console.log(`\n  ${"NAME".padEnd(30)} ${"PROVIDER".padEnd(12)} TYPE`);
      console.log(`  ${"─".repeat(55)}`);
      for (const c of creds) {
        console.log(`  ${c.name.padEnd(30)} ${c.provider.padEnd(12)} ${c.type}`);
      }
      console.log();
    });

  cred
    .command("add")
    .description("Add a new credential (stored only on this machine)")
    .option("--name <name>", "Credential name")
    .option("--provider <provider>", "Provider: claude, mistral, gitlab, github")
    .option("--type <type>", "Type: api_key, oauth, access_token", "api_key")
    .action(async (opts) => {
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

      try {
        const name = opts.name || (await ask("Credential name: ")).trim();
        if (!name) { console.error("Name is required."); process.exit(1); }

        const provider = opts.provider || (await selectProvider());
        if (!provider) { console.error("Provider is required."); process.exit(1); }

        const type = opts.type || "api_key";

        rl.close();

        const label = provider === "gitlab" || provider === "github" ? "Access token: " : "API key: ";
        const key = await readSecret(label);
        if (!key) { console.error("Value cannot be empty."); process.exit(1); }

        await addCredential(name, provider, type as "oauth" | "api_key" | "access_token", key);
        console.log(`✓ Credential "${name}" stored locally.`);
      } catch (err) {
        rl.close();
        throw err;
      }
    });

  cred
    .command("remove <name>")
    .description("Remove a stored credential")
    .action(async (name: string) => {
      await removeCredential(name);
      console.log(`✓ Credential "${name}" removed.`);
    });
}

const PROVIDERS = ["claude", "deepseek", "mistral", "gitlab", "github"];

function selectProvider(): Promise<string> {
  return new Promise((resolve) => {
    let idx = 0;

    function render() {
      process.stdout.write("\x1b[?25l"); // hide cursor
      process.stdout.write(`Provider:\n`);
      for (let i = 0; i < PROVIDERS.length; i++) {
        const selected = i === idx;
        process.stdout.write(`  ${selected ? "\x1b[36m❯ " : "  "}${PROVIDERS[i]}\x1b[0m\n`);
      }
    }

    function clear() {
      process.stdout.write(`\x1b[${PROVIDERS.length + 1}A\x1b[0J`);
    }

    render();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", function handler(ch) {
      const c = ch.toString();
      if (c === "") { process.exit(1); }
      if (c === "\r" || c === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", handler);
        clear();
        process.stdout.write(`Provider: \x1b[36m${PROVIDERS[idx]}\x1b[0m\n`);
        process.stdout.write("\x1b[?25h"); // show cursor
        resolve(PROVIDERS[idx]);
      } else if (c === "\x1b[A") {
        idx = (idx - 1 + PROVIDERS.length) % PROVIDERS.length;
        clear();
        render();
      } else if (c === "\x1b[B") {
        idx = (idx + 1) % PROVIDERS.length;
        clear();
        render();
      }
    });
  });
}

function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    let key = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", function handler(ch) {
      const c = ch.toString();
      if (c === "\r" || c === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", handler);
        process.stdout.write("\n");
        resolve(key);
      } else if (c === "\u0003") {
        process.exit(1);
      } else if (c === "\u007f") {
        key = key.slice(0, -1);
      } else {
        key += c;
      }
    });
  });
}
