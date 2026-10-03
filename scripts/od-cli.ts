// The `od` command: owner commands for the shell's `/api/v1` (labels, promotions, status).
// `runOd` takes its network, token, and output as arguments so tests run it against a shell
// with the in-memory store. The entry point is scripts/od.ts. Never print the token.
import { parseArgs } from "node:util";

export const LOCAL_BASE_URL = "http://localhost:8000";
export const PROD_BASE_URL = "https://od.joshhale.me";

export interface OdEnvironment {
  fetch: typeof fetch;
  /** The owner token. Reads work without one. */
  token?: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = `Usage: deno task od [--base-url <url> | --prod] <command>

Commands:
  label set <name> <branch|sha>   Point a label at a branch (it follows the branch) or a commit
  label rename <old> <new>        Rename a label
  label rm <name>                 Delete a label
  labels                          List labels with their resolved commits
  promote <label|branch|sha>      Make that build main (saves the resolved commit)
  promotions                      List promotions, newest first
  status                          Show main, labels, and live sessions

Options:
  --base-url <url>   The shell to talk to (default ${LOCAL_BASE_URL})
  --prod             Use ${PROD_BASE_URL} and the token in .env.prod
  --note <text>      A note for promote
  --help             Show help for a command

Writes need OD_OWNER_TOKEN (.env locally, .env.prod with --prod).`;

const HELP: Record<string, string> = {
  "label set":
    "Usage: deno task od label set <name> <branch|sha>\n\nCreates or moves a label. A branch name makes the label follow that branch's latest commit;\na commit SHA pins it. The shell checks that the branch or commit exists.",
  "label rename":
    "Usage: deno task od label rename <old> <new>\n\nRenames a label. Fails when <new> is taken.",
  "label rm": "Usage: deno task od label rm <name>\n\nDeletes a label.",
  labels:
    "Usage: deno task od labels\n\nLists labels with the commit each points to now.",
  promote:
    "Usage: deno task od promote <label|branch|sha> [--note <text>]\n\nMakes the build main. The shell saves the resolved commit, so main does not follow later pushes.",
  promotions:
    "Usage: deno task od promotions\n\nLists promotions, newest first.",
  status:
    "Usage: deno task od status\n\nShows main, the labels with their resolved commits, and live sessions.",
};

interface Label {
  name: string;
  kind: string;
  target: string;
  commit: string | null;
}
interface Promotion {
  commit: string;
  label: string;
  at: number;
  note: string;
}
interface LiveSession {
  id: string;
  buildCommit: string;
  label: string | null;
  playerCount: number;
}

class UsageError extends Error {}

const short = (sha: string | null) => sha ? sha.slice(0, 7) : "unknown";
const when = (at: number) => new Date(at).toISOString();

function labelLine(label: Label): string {
  const target = label.kind === "branch"
    ? `branch ${label.target}`
    : `commit ${short(label.target)}`;
  return `${label.name}  ${target}  ->  ${short(label.commit)}`;
}

function promotionLine(promotion: Promotion): string {
  const note = promotion.note ? `  "${promotion.note}"` : "";
  return `${when(promotion.at)}  ${
    short(promotion.commit)
  }  from ${promotion.label}${note}`;
}

/** Runs one command and returns the exit code. */
export async function runOd(
  argv: string[],
  env: OdEnvironment,
): Promise<number> {
  try {
    return await run(argv, env);
  } catch (error) {
    env.err(
      error instanceof UsageError
        ? `${error.message}\nRun with --help for usage.`
        : `od: ${error instanceof Error ? error.message : String(error)}`,
    );
    return error instanceof UsageError ? 2 : 1;
  }
}

async function run(argv: string[], env: OdEnvironment): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "base-url": { type: "string" },
        prod: { type: "boolean" },
        note: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  const [first, second, ...rest] = positionals;
  const command = first === "label" ? `label ${second ?? ""}`.trim() : first;
  const args = first === "label" ? rest : [second, ...rest].filter(Boolean);
  if (!command || (values.help && !(command in HELP))) {
    env.out(USAGE);
    return command || values.help ? 0 : 2;
  }
  if (!(command in HELP)) throw new UsageError(`Unknown command: ${command}`);
  if (values.help) {
    env.out(HELP[command]);
    return 0;
  }
  if (values.prod && values["base-url"]) {
    throw new UsageError("Use --prod or --base-url, not both.");
  }
  const base =
    (values.prod ? PROD_BASE_URL : values["base-url"] ?? LOCAL_BASE_URL)
      .replace(/\/+$/, "");

  async function call(
    method: string,
    path: string,
    body?: unknown,
    write = false,
  ) {
    if (write && !env.token) {
      throw new Error(
        `OD_OWNER_TOKEN is not set (${
          values.prod ? ".env.prod" : "the environment or .env"
        })`,
      );
    }
    const headers: Record<string, string> = {};
    if (env.token && write) headers.authorization = `Bearer ${env.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await env.fetch(`${base}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({})) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      const reason = typeof data.error === "string" ? data.error : "";
      throw new Error(`${response.status} ${reason || response.statusText}`);
    }
    return data;
  }

  const need = (count: number, usage: string) => {
    if (args.length !== count) throw new UsageError(`Usage: od ${usage}`);
  };
  const name = (index: number) => encodeURIComponent(args[index]);

  switch (command) {
    case "label set": {
      need(2, "label set <name> <branch|sha>");
      const label = await call("PUT", `/labels/${name(0)}`, {
        target: args[1],
      }, true) as unknown as Label;
      env.out(labelLine(label));
      break;
    }
    case "label rename": {
      need(2, "label rename <old> <new>");
      const label = await call("POST", `/labels/${name(0)}/rename`, {
        to: args[1],
      }, true) as unknown as Label;
      env.out(`Renamed ${args[0]} to ${label.name}`);
      break;
    }
    case "label rm":
      need(1, "label rm <name>");
      await call("DELETE", `/labels/${name(0)}`, undefined, true);
      env.out(`Deleted ${args[0]}`);
      break;
    case "labels": {
      need(0, "labels");
      const { labels } = await call("GET", "/labels") as { labels: Label[] };
      if (!labels.length) env.out("No labels.");
      for (const label of labels) env.out(labelLine(label));
      break;
    }
    case "promote": {
      need(1, "promote <label|branch|sha> [--note <text>]");
      const promotion = await call("POST", "/promotions", {
        target: args[0],
        note: values.note,
      }, true) as unknown as Promotion;
      env.out(`Main is now ${promotion.commit} (from ${promotion.label})`);
      break;
    }
    case "promotions": {
      need(0, "promotions");
      const { promotions } = await call("GET", "/promotions") as {
        promotions: Promotion[];
      };
      if (!promotions.length) env.out("No promotions.");
      for (const promotion of promotions) env.out(promotionLine(promotion));
      break;
    }
    case "status": {
      need(0, "status");
      const status = await call("GET", "/status") as {
        main: Promotion | null;
        labels: Label[];
        sessions: LiveSession[];
      };
      env.out(
        status.main
          ? `Main: ${status.main.commit} (from ${status.main.label}, ${
            when(status.main.at)
          })`
          : "Main: none promoted yet",
      );
      env.out(`Labels (${status.labels.length}):`);
      for (const label of status.labels) env.out(`  ${labelLine(label)}`);
      env.out(`Live sessions (${status.sessions.length}):`);
      for (const session of status.sessions) {
        env.out(
          `  ${session.id}  ${short(session.buildCommit)}${
            session.label ? ` (${session.label})` : ""
          }  ${session.playerCount} players`,
        );
      }
      break;
    }
  }
  return 0;
}

/** `OD_OWNER_TOKEN` from the text of a `.env` file. */
export function tokenFromEnvFile(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*OD_OWNER_TOKEN\s*=\s*(.*?)\s*$/);
    if (match) return match[1].replace(/^(["'])(.*)\1$/, "$2") || undefined;
  }
  return undefined;
}
