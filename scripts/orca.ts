// Coordinator commands for running tickets as Orca workers.
//
//   deno task orca start --issue 60 --slug webgl-ui --title "..." [--base t22-ios-chat-bar] [--notes notes.md]
//   deno task orca wait [--timeout-ms 3600000]
//   deno task orca merge --pr 61 [--comment "..."] [--map 41 --decision "- [Title](url) — gist"]
//
// The run comes from ORCA_RUN or `--run`. `start` fills docs/orca/worker-brief.md and starts a
// Sonnet worker in a new worktree. `wait` acknowledges heartbeats and returns only reports that
// need the coordinator: worker_done, escalation, and question. `merge` squash-merges a PR,
// deletes its branch, releases its worker, removes its worktree, pulls, and records the
// decision on the map issue.

const REPO = "LegoGuy32109/OpenDwarf";
const REPO_ID = "0ab44644-7ce6-4764-aedd-110d641adfb1";
const MODEL = "claude-sonnet-5-5";
const BRIEF = new URL("../docs/orca/worker-brief.md", import.meta.url);
const ACTIONABLE = ["worker_done", "escalation", "question"];

type Json = Record<string, unknown>;

async function run(
  command: string,
  args: string[],
  options: { input?: string; allowFailure?: boolean } = {},
): Promise<string> {
  const child = new Deno.Command(command, {
    args,
    stdin: options.input === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (options.input !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(options.input));
    await writer.close();
  }
  const result = await child.output();
  const out = new TextDecoder().decode(result.stdout);
  if (!result.success && !options.allowFailure) {
    const err = new TextDecoder().decode(result.stderr);
    throw new Error(
      `${command} ${args[0]} ${args[1] ?? ""} failed:\n${err || out}`,
    );
  }
  return out;
}

/** Runs an Orca command with --json and returns its `result`, ignoring keepalive lines. */
async function orca(args: string[]): Promise<Json> {
  const out = await run("orca", [...args, "--json"], { allowFailure: true });
  const lines = out.split("\n").filter((line) => !line.includes("_keepalive"));
  let data: Json;
  try {
    data = JSON.parse(lines.join("\n")) as Json;
  } catch {
    throw new Error(`orca ${args.slice(0, 2).join(" ")} gave no JSON:\n${out}`);
  }
  if (data.ok === false) {
    const error = data.error as { code?: string; message?: string } | undefined;
    if (error?.code === "waiter_exists") {
      throw new Error(
        "Another wait is already running for this run; stop it first.",
      );
    }
    throw new Error(error?.message ?? JSON.stringify(data.error));
  }
  return (data.result ?? {}) as Json;
}

function runId(flags: { run?: string }): string {
  const id = flags.run ?? Deno.env.get("ORCA_RUN");
  if (!id) throw new Error("Set ORCA_RUN or pass --run <run_id>");
  return id;
}

/** Reads `--name value` pairs. */
export function parseFlags(args: string[]): Record<string, string | undefined> {
  const flags: Record<string, string | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const name = /^--([a-z-]+)$/.exec(args[i])?.[1];
    if (!name || args[i + 1] === undefined) {
      throw new Error(`Expected --flag value, got ${args[i]}`);
    }
    flags[name] = args[++i];
  }
  return flags;
}

/** Fills the brief template: {issue}, {slug}, {branch}, {base}, {port}, {notes}. */
export function fillBrief(
  template: string,
  values: {
    issue: number;
    slug: string;
    base: string;
    port: number;
    notes: string;
  },
): string {
  const fields: Record<string, string> = {
    issue: String(values.issue),
    slug: values.slug,
    branch: `t${values.issue}-${values.slug}`,
    base: values.base,
    port: String(values.port),
    notes: values.notes.trim() ? `NOTES:\n${values.notes.trim()}` : "",
  };
  return template.replace(
    /\{(\w+)\}/g,
    (match, key: string) => fields[key] ?? match,
  );
}

async function start(flags: Record<string, string | undefined>) {
  const issue = Number(flags.issue);
  const { slug, title } = flags;
  if (!Number.isInteger(issue) || !slug || !title) {
    throw new Error("start needs --issue <n> --slug <slug> --title <text>");
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("--slug must be lowercase words and dashes");
  }
  // A pull request shares the issue numbering, so check the number names an open issue.
  const target = JSON.parse(
    await run("gh", [
      "issue",
      "view",
      String(issue),
      "-R",
      REPO,
      "--json",
      "url,state,title",
    ]),
  ) as { url: string; state: string; title: string };
  if (!target.url.includes("/issues/") || target.state !== "OPEN") {
    throw new Error(
      `#${issue} is not an open issue: ${target.url} (${target.state})`,
    );
  }
  console.log(`Issue #${issue}: ${target.title}`);
  const base = flags.base ?? "client-first-deno";
  const port = Number(flags.port ?? 8100 + (issue % 100));
  const notes = flags.notes ? await Deno.readTextFile(flags.notes) : "";
  const spec = fillBrief(await Deno.readTextFile(BRIEF), {
    issue,
    slug,
    base,
    port,
    notes,
  });
  const branch = `t${issue}-${slug}`;
  const result = await orca([
    "orchestration",
    "worker-start",
    "--run",
    runId(flags),
    "--spec",
    spec,
    "--task-title",
    `Issue #${issue} ${title}`,
    "--worktree",
    "new-top-level",
    "--name",
    branch,
    "--repo",
    `id:${REPO_ID}`,
    "--base-branch",
    `origin/${base}`,
    "--setup",
    "run",
    "--agent",
    "claude",
    "--model",
    MODEL,
  ]);
  await run("gh", [
    "issue",
    "edit",
    String(issue),
    "-R",
    REPO,
    "--add-assignee",
    "@me",
  ]);
  console.log(
    `Started ${branch} on origin/${base} (port ${port}); stage ${result.stage}.`,
  );
}

async function wait(flags: Record<string, string | undefined>) {
  const id = runId(flags);
  const deadline = Date.now() + Number(flags["timeout-ms"] ?? 3_600_000);
  let ack: string | undefined;
  while (Date.now() < deadline) {
    const result = await orca([
      "orchestration",
      "check",
      "--run",
      id,
      ...(ack ? ["--ack", ack] : []),
      "--wait",
      "--timeout-ms",
      String(Math.max(1000, deadline - Date.now())),
    ]);
    ack = result.deliveryId as string | undefined;
    const messages = (result.messages ?? []) as Json[];
    const actionable = messages.filter((m) =>
      ACTIONABLE.includes(String(m.type))
    );
    if (actionable.length) {
      for (const m of actionable) {
        console.log(
          `[${m.type}] from ${m.from_handle}: ${m.subject}\n${m.body ?? ""}`
            .trim(),
        );
      }
      // Acknowledge now: an unacknowledged batch comes back on the next wait.
      await orca([
        "orchestration",
        "check",
        "--run",
        id,
        "--ack",
        String(ack),
        "--peek",
      ]);
      return;
    }
    if (result.timedOut) break;
  }
  if (ack) {
    await orca(["orchestration", "check", "--run", id, "--ack", ack, "--peek"]);
  }
  console.log("No worker reports before the timeout.");
}

async function merge(flags: Record<string, string | undefined>) {
  const pr = flags.pr;
  if (!pr) throw new Error("merge needs --pr <number>");
  const info = JSON.parse(
    await run("gh", [
      "pr",
      "view",
      pr,
      "-R",
      REPO,
      "--json",
      "headRefName,state,title",
    ]),
  ) as { headRefName: string; state: string; title: string };
  if (flags.comment) {
    await run("gh", ["pr", "comment", pr, "-R", REPO, "--body-file", "-"], {
      input: flags.comment,
    });
  }
  if (info.state === "OPEN") {
    await run("gh", [
      "pr",
      "merge",
      pr,
      "-R",
      REPO,
      "--squash",
      "--delete-branch",
    ]);
  }
  console.log(`Merged #${pr} ${info.title}`);
  const branch = info.headRefName;
  const workers =
    ((await orca(["orchestration", "worker-list"])).workers ?? []) as Json[];
  for (const worker of workers) {
    const resource = worker.resource as Json | undefined;
    if (!String(resource?.worktreeId ?? "").endsWith(`/${branch}`)) continue;
    if (worker.terminalState !== "released") {
      await orca([
        "orchestration",
        "worker-release",
        "--dispatch",
        String(worker.dispatchId),
      ])
        .catch((error) => console.log(`Release skipped: ${error.message}`));
    }
  }
  await orca(["worktree", "rm", "--worktree", `branch:${branch}`, "--force"])
    .then(() => console.log(`Removed worktree ${branch}`))
    .catch((error) => console.log(`Worktree not removed: ${error.message}`));
  await run("git", ["pull", "--ff-only", "-q"]).catch((error) =>
    console.log(`Pull skipped: ${error.message}`)
  );
  if (flags.map && flags.decision) {
    const body = (JSON.parse(
      await run("gh", [
        "issue",
        "view",
        flags.map,
        "-R",
        REPO,
        "--json",
        "body",
      ]),
    ) as { body: string }).body;
    const heading = "## Decisions so far";
    const at = body.indexOf(heading);
    if (at < 0) {
      throw new Error(`Map #${flags.map} has no "${heading}" section`);
    }
    const next = body.indexOf("\n## ", at + heading.length);
    const end = next < 0 ? body.length : next;
    const updated = `${body.slice(0, end).trimEnd()}\n${flags.decision}\n${
      body.slice(end)
    }`;
    await run("gh", [
      "issue",
      "edit",
      flags.map,
      "-R",
      REPO,
      "--body-file",
      "-",
    ], {
      input: updated,
    });
    console.log(`Recorded the decision on map #${flags.map}`);
  }
}

if (import.meta.main) {
  const [command, ...rest] = Deno.args;
  const commands: Record<
    string,
    (f: Record<string, string | undefined>) => Promise<void>
  > = {
    start,
    wait,
    merge,
  };
  const action = commands[command ?? ""];
  if (!action) {
    console.error(
      "Usage: deno task orca <start|wait|merge> [flags]; see scripts/orca.ts",
    );
    Deno.exit(2);
  }
  try {
    await action(parseFlags(rest));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
