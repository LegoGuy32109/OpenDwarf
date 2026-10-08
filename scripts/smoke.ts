// Smoke-tests a deployed build: a headless host opens the page, a guest joins
// its session, and the shell must report both players with no page errors.
//
//   deno task smoke [path] [commit prefix]   # defaults: / and main's commit
//
// SMOKE_BASE overrides https://od.joshhale.me.
import { chromium } from "@playwright/test";
const base = Deno.env.get("SMOKE_BASE") ?? "https://od.joshhale.me";
const path = Deno.args[0] ?? "/";
const commit = Deno.args[1] ??
  /"commit":"([0-9a-f]{7})/.exec(await (await fetch(`${base}${path}`)).text())
    ?.[1] ??
  "";
// Media: the shell redirects to the bucket, which must answer with the music index.
const index = await fetch(`${base}/media/index/music.v1.json`);
const tracks = index.ok ? (await index.json()).tracks : null;
if (!Array.isArray(tracks)) {
  console.log("media index failed:", index.status, index.url.split("?")[0]);
  Deno.exit(1);
}
console.log("media index tracks:", tracks.length);
const browser = await chromium.launch();
const host = await browser.newPage();
const guest = await browser.newPage();
const errors: string[] = [];
for (const [n, p] of [["host", host], ["guest", guest]] as const) {
  p.on("pageerror", (e) => errors.push(`${n} ${String(e).slice(0, 160)}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`${n} ${m.text().slice(0, 160)}`);
  });
}
const sessions = async () =>
  (await (await fetch(`${base}/api/v1/sessions`)).json()).sessions as {
    id: string;
    build: { commit: string; path: string };
    playerCount: number;
    started: number;
  }[];
const before = new Set((await sessions()).map((s) => s.id));
// `test=1` flags the session and its telemetry as a test, so analysis leaves it out.
const testFlag = (url: string) =>
  `${url}${url.includes("?") ? "&" : "?"}test=1`;
await host.goto(testFlag(`${base}${path}`));
let mine: Awaited<ReturnType<typeof sessions>>[number] | undefined;
for (let i = 0; i < 30 && !mine; i++) {
  await host.waitForTimeout(1000);
  mine = (await sessions()).find((s) =>
    !before.has(s.id) && s.build.commit.startsWith(commit)
  );
}
if (!mine) {
  console.log("no session started on", commit, errors);
  Deno.exit(1);
}
console.log("host session on", mine.build.commit.slice(0, 7));
await guest.goto(testFlag(`${base}${mine.build.path}join/${mine.id}`));
let players = 0;
for (let i = 0; i < 40 && players < 2; i++) {
  await host.waitForTimeout(1000);
  players = (await sessions()).find((s) => s.id === mine!.id)?.playerCount ?? 0;
}
console.log("players reported (host and guest):", players);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
Deno.exit(players >= 2 && !errors.length ? 0 : 1);
