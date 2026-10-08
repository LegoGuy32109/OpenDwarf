// Reads client telemetry from the shell's Deno Deploy log and summarizes it per session.
//
//   deno task telemetry [--start <ISO|-2h>] [--end <ISO>] [--session <id prefix>] [--all]
//   deno task telemetry --file <saved.jsonl> [--session <id prefix>]
//   deno task telemetry --follow --save <file.jsonl>     # tail live logs into a file
//
// `--save` keeps the raw log lines so a test can be analyzed again after Deno Deploy drops them
// (the log reaches back about a day). Without `--all`, sessions flagged as tests are left out.
// Requires DENO_DEPLOY_TOKEN in the environment unless `--file` is given.

const ORG = "legoguy32109";
const APP = "opendwarf";
const CONFIG = new URL("../deno.json", import.meta.url);
const CLI = "jsr:@deno/deploy@0.0.9904";

/** One telemetry line the shell logs (`src/server/app.ts`), plus the log timestamp. */
export type Event = {
  ts: string;
  kind: "summary" | "connection" | "error" | "spike";
  session: string;
  participant: string;
  role: "host" | "guest";
  test: boolean;
  route: string;
  status: string;
  players: number | null;
  frameMeanMs: number | null;
  frameMaxMs: number | null;
  rttMs: number | null;
  bytesSent: number | null;
  queuedBytes: number | null;
  commit?: string | null;
  detail?: string | null;
  metrics?: Record<string, number>;
};

/** Telemetry events from `deno deploy logs --json` output, oldest first, each line once. */
export function parseLog(text: string): Event[] {
  const events: Event[] = [];
  // Saved captures overlap; a line seen twice counts once.
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.trim() || seen.has(line)) continue;
    seen.add(line);
    try {
      const row = JSON.parse(line);
      const body = JSON.parse(String(row.body).trim());
      if (body?.event === "open-dwarf-client") {
        events.push({ ...body, ts: row.timestamp ?? body.at });
      }
    } catch {
      // Not a telemetry line.
    }
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const numbers = (values: (number | null | undefined)[]) =>
  values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
const fixed = (value: number | null, digits = 1) =>
  value === null ? "-" : value.toFixed(digits);
/** The growth of a counter that restarts at zero when the page reloads. */
export const growth = (values: number[]) => {
  let total = 0;
  for (let i = 1; i < values.length; i++) {
    total += values[i] >= values[i - 1] ? values[i] - values[i - 1] : values[i];
  }
  return values.length ? total + (values.length === 1 ? values[0] : 0) : 0;
};

/** A plain-text report of one session: who played, frame health, network, and every error and spike. */
export function sessionReport(events: Event[]): string {
  const out: string[] = [];
  const first = events[0];
  const last = events[events.length - 1];
  const minutes = (Date.parse(last.ts) - Date.parse(first.ts)) / 60_000;
  const commits = [
    ...new Set(events.map((e) => e.commit?.slice(0, 7)).filter(Boolean)),
  ];
  const players = numbers(events.map((e) => e.players));
  out.push(
    `session ${first.session}${first.test ? " (test)" : ""}  ${
      first.ts.slice(0, 19)
    }Z  ${fixed(minutes)} min  players (NPC included) up to ${
      players.length ? Math.max(...players) : "-"
    }  commit ${commits.join(",") || "-"}`,
  );
  const byParticipant = new Map<string, Event[]>();
  for (const event of events) {
    const key = `${event.role} ${event.participant.slice(0, 13)}`;
    byParticipant.set(key, [...(byParticipant.get(key) ?? []), event]);
  }
  out.push(
    "  who                 summaries  fps   p95 med/worst  spikes>33/>100  long tasks (max)  render ms  rtt p50/p95  route",
  );
  for (const [who, list] of byParticipant) {
    const summaries = list.filter((e) => e.kind === "summary");
    const mean = percentile(numbers(summaries.map((e) => e.frameMeanMs)), 0.5);
    const p95 = numbers(summaries.map((e) => e.metrics?.frameP95Ms));
    const rtt = numbers(summaries.map((e) => e.rttMs));
    const longest = numbers(summaries.map((e) => e.metrics?.longestTaskMs));
    const routes = [...new Set(list.map((e) => e.route))].filter((r) =>
      r !== "none" && r !== "unknown" && r !== "connecting"
    );
    out.push(
      `  ${who.padEnd(19)} ${String(summaries.length).padStart(9)}  ${
        mean ? (1000 / mean).toFixed(0).padStart(3) : "  -"
      }   ${fixed(percentile(p95, 0.5)).padStart(5)}/${
        fixed(p95.length ? Math.max(...p95) : null).padEnd(6)
      }  ${
        String(growth(numbers(summaries.map((e) => e.metrics?.spikes33))))
          .padStart(6)
      }/${
        String(growth(numbers(summaries.map((e) => e.metrics?.spikes100))))
          .padEnd(6)
      }  ${
        String(growth(numbers(summaries.map((e) => e.metrics?.longTasks))))
          .padStart(5)
      } (${longest.length ? Math.max(...longest) : "-"})`.padEnd(98) +
        `  ${
          fixed(percentile(
            numbers(summaries.map((e) => e.metrics?.renderMs)),
            0.5,
          ))
            .padStart(5)
        }      ${fixed(percentile(rtt, 0.5), 0)}/${
          fixed(percentile(rtt, 0.95), 0)
        }  ${routes.join(",") || "-"}`,
    );
  }
  const host = events.filter((e) => e.role === "host" && e.kind === "summary");
  if (host.length > 1) {
    const sent = host.map((e) => ({
      t: Date.parse(e.ts),
      bytes: e.bytesSent ?? 0,
    }));
    const rates: number[] = [];
    for (let i = 1; i < sent.length; i++) {
      const seconds = (sent[i].t - sent[i - 1].t) / 1000;
      const bytes = sent[i].bytes - sent[i - 1].bytes;
      if (seconds > 0 && bytes >= 0) rates.push(bytes / 1024 / seconds);
    }
    const queued = numbers(host.map((e) => e.queuedBytes));
    out.push(
      `  host upload KiB/s p50 ${fixed(percentile(rates, 0.5))}  p95 ${
        fixed(percentile(rates, 0.95))
      }  max ${fixed(rates.length ? Math.max(...rates) : null)}  queued max ${
        queued.length ? Math.max(...queued) : "-"
      } B`,
    );
  }
  const timeline = new Map<
    string,
    { players: number; p95: number; slow: string[] }
  >();
  for (const event of events.filter((e) => e.kind === "summary")) {
    const minute = event.ts.slice(11, 16);
    const row = timeline.get(minute) ?? { players: 0, p95: 0, slow: [] };
    row.players = Math.max(row.players, event.players ?? 0);
    const p95 = event.metrics?.frameP95Ms ?? 0;
    if (p95 > row.p95) row.p95 = p95;
    if (p95 > 33) {
      row.slow.push(`${event.role}:${event.participant.slice(0, 13)}`);
    }
    timeline.set(minute, row);
  }
  if (timeline.size > 1) {
    out.push("  minute  players  worst p95  over 33 ms");
    for (const [minute, row] of timeline) {
      out.push(
        `  ${minute}   ${String(row.players).padStart(5)}  ${
          fixed(row.p95).padStart(9)
        }  ${[...new Set(row.slow)].join(" ")}`,
      );
    }
  }
  const notable = events.filter((e) =>
    e.kind === "error" || e.kind === "spike" ||
    (e.kind === "connection" && e.status !== "hosting")
  );
  if (notable.length) out.push("  events:");
  for (const event of notable) {
    out.push(
      `  ${event.ts.slice(11, 19)} ${event.role} ${
        event.participant.slice(0, 13)
      } ${event.kind} ${event.status}${
        event.detail ? `  ${event.detail}` : ""
      }${
        event.kind === "spike" && event.metrics
          ? `  ${JSON.stringify(event.metrics)}`
          : ""
      }`,
    );
  }
  return out.join("\n");
}

/** Runs the deploy CLI and puts deno.json back, which the CLI rewrites. */
async function deployCli(args: string[], stdout: "piped" | "inherit") {
  const before = await Deno.readFile(CONFIG);
  try {
    const child = new Deno.Command("deno", {
      args: ["run", "-A", "--no-lock", CLI, ...args],
      stdout,
      stderr: "inherit",
    }).spawn();
    return await child.output();
  } finally {
    const after = await Deno.readFile(CONFIG);
    if (
      before.length !== after.length || before.some((b, i) => b !== after[i])
    ) {
      await Deno.writeFile(CONFIG, before);
    }
  }
}

/** `-2h`, `-30m` or `-1d` back from now, or an ISO time. */
function startTime(value: string) {
  const relative = /^-(\d+)([mhd])$/.exec(value);
  if (!relative) return value;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2] as "m"];
  return new Date(Date.now() - Number(relative[1]) * unit).toISOString();
}

if (import.meta.main) {
  /** `--name value` flags and `--name` switches. */
  const args: Record<string, string | boolean | undefined> = {};
  for (let i = 0; i < Deno.args.length; i++) {
    const name = Deno.args[i].replace(/^--/, "");
    const next = Deno.args[i + 1];
    if (["all", "follow", "help"].includes(name)) args[name] = true;
    else if (next !== undefined) args[name] = Deno.args[++i];
  }
  const text = (name: string) =>
    typeof args[name] === "string" ? args[name] as string : undefined;
  if (args.help) {
    console.log(
      "deno task telemetry [--start <ISO|-2h>] [--end <ISO>] [--session <prefix>] [--all] [--file <jsonl>] [--save <jsonl>] [--follow]",
    );
    Deno.exit(0);
  }
  const base = [
    "logs",
    "--org",
    ORG,
    "--app",
    APP,
    "--json",
    "--non-interactive",
  ];
  if (args.follow) {
    const save = text("save");
    if (!save) throw new Error("--follow needs --save <file.jsonl>");
    console.log(`Tailing live logs into ${save}; stop with Ctrl+C.`);
    const file = await Deno.open(save, {
      append: true,
      create: true,
      write: true,
    });
    const before = await Deno.readFile(CONFIG);
    const child = new Deno.Command("deno", {
      args: ["run", "-A", "--no-lock", CLI, ...base],
      stdout: "piped",
      stderr: "inherit",
    }).spawn();
    try {
      await child.stdout.pipeTo(file.writable);
    } finally {
      await Deno.writeFile(CONFIG, before);
    }
    Deno.exit(0);
  }
  let log: string;
  const file = text("file");
  if (file) log = await Deno.readTextFile(file);
  else {
    const range = ["--once", "--start", startTime(text("start") ?? "-1h")];
    const end = text("end");
    if (end) range.push("--end", end);
    const result = await deployCli([...base, ...range], "piped");
    if (!result.success) Deno.exit(result.code);
    log = new TextDecoder().decode(result.stdout);
    const save = text("save");
    if (save) await Deno.writeTextFile(save, log, { append: true });
  }
  const events = parseLog(log);
  const sessions = new Map<string, Event[]>();
  for (const event of events) {
    const session = text("session");
    if (session && !event.session.startsWith(session)) continue;
    if (!args.all && event.test) continue;
    sessions.set(event.session, [
      ...(sessions.get(event.session) ?? []),
      event,
    ]);
  }
  console.log(
    `${events.length} telemetry events, ${sessions.size} sessions${
      events.length
        ? `, ${events[0].ts.slice(0, 19)}Z to ${
          events.at(-1)!.ts.slice(0, 19)
        }Z`
        : ""
    }\n`,
  );
  for (const list of sessions.values()) console.log(sessionReport(list) + "\n");
}
