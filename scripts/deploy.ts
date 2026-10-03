// Deploys the shell to the Deno Deploy application `opendwarf` in the organization `legoguy32109`
// as a production revision, then records a Shell deploy (commit, Deno revision, time, note) in
// `od-prod`. The rules live in scripts/shell-deploy.ts. Client changes never need a deploy.
//
// The deploy CLI rewrites deno.json (it re-serializes the file and drops the trailing newline).
// This script keeps the bytes it found and restores them after the CLI exits, so a deploy leaves
// a clean tree.
//
// Usage: deno task deploy [--dry-run] [--note "why"]
// Requires DENO_DEPLOY_TOKEN in the environment, and TURSO_DB_URL and TURSO_DB_TOKEN in
// `.env.prod`. Never print them.
import { createClient } from "@tursodatabase/serverless/compat";
import {
  appliedLedger,
  migrationHistory,
  pendingAgainst,
} from "../src/server/migrations.ts";
import { createTursoStore } from "../src/server/store.ts";
import {
  type DeployCommands,
  DeployRefused,
  runShellDeploy,
} from "./shell-deploy.ts";

const CONFIG = new URL("../deno.json", import.meta.url);
const ENV_PROD = new URL("../.env.prod", import.meta.url);

async function output(command: string, args: string[]): Promise<string> {
  const result = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`${command} ${args[0]} failed`);
  return new TextDecoder().decode(result.stdout);
}

let client: ReturnType<typeof createClient> | undefined;

/** TURSO_DB_URL and TURSO_DB_TOKEN from `.env.prod` itself, never from the process environment. */
async function productionClient() {
  if (client) return client;
  const values = new Map<string, string>();
  for (const line of (await Deno.readTextFile(ENV_PROD)).split("\n")) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match) values.set(match[1], match[2].replace(/^(["'])(.*)\1$/, "$2"));
  }
  const url = values.get("TURSO_DB_URL");
  const authToken = values.get("TURSO_DB_TOKEN");
  if (!url || !authToken) {
    throw new DeployRefused(
      "TURSO_DB_URL and TURSO_DB_TOKEN are missing from .env.prod",
    );
  }
  client = createClient({ url, authToken });
  return client;
}

const commands: DeployCommands = {
  async dirtyFiles() {
    return (await output("git", ["status", "--porcelain"])).split("\n")
      .filter(Boolean);
  },
  async headCommit() {
    return (await output("git", ["rev-parse", "HEAD"])).trim();
  },
  async pendingProductionMigrations() {
    try {
      await Deno.stat(ENV_PROD);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
    const db = await productionClient();
    return pendingAgainst(await migrationHistory(), await appliedLedger(db))
      .map((migration) => migration.version);
  },
  async trackedFiles() {
    return (await output("git", ["ls-files"])).split("\n").filter(Boolean);
  },
  async excludes() {
    const config = JSON.parse(await Deno.readTextFile(CONFIG));
    return config.deploy?.exclude ?? [];
  },
  async deploy(args) {
    const before = await Deno.readFile(CONFIG);
    const result = await new Deno.Command("deno", {
      args,
      stdout: "piped",
      stderr: "inherit",
    }).output();
    const after = await Deno.readFile(CONFIG);
    if (
      before.length !== after.length || before.some((b, i) => b !== after[i])
    ) {
      await Deno.writeFile(CONFIG, before);
      console.log(
        `Restored deno.json after the deploy CLI rewrote it (${after.length} bytes back to ${before.length}).`,
      );
    }
    return {
      success: result.success,
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout).trim(),
    };
  },
  store() {
    // Only called after the migration check opened the client.
    if (!client) throw new Error("production client is not open");
    return createTursoStore(client);
  },
};

if (import.meta.main) {
  const noteAt = Deno.args.indexOf("--note");
  try {
    const lines = await runShellDeploy(commands, {
      dryRun: Deno.args.includes("--dry-run"),
      note: noteAt >= 0 ? (Deno.args[noteAt + 1] ?? "") : "",
      hasToken: Boolean(Deno.env.get("DENO_DEPLOY_TOKEN")),
    });
    console.log(lines.join("\n"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "deploy failed");
    Deno.exit(1);
  }
}
