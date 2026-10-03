// Entry point for `deno task od <command>`. See scripts/od-cli.ts for the commands.
// The production token comes only from `.env.prod`, so a local token is never sent to production.
import { runOd, tokenFromEnvFile } from "./od-cli.ts";

async function readEnvFile(name: string): Promise<string | undefined> {
  try {
    return tokenFromEnvFile(
      await Deno.readTextFile(new URL(`../${name}`, import.meta.url)),
    );
  } catch {
    return undefined;
  }
}

const args = Deno.args;
const token = args.includes("--prod")
  ? await readEnvFile(".env.prod")
  : Deno.env.get("OD_OWNER_TOKEN") || await readEnvFile(".env");

Deno.exit(
  await runOd(args, {
    fetch,
    token,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }),
);
