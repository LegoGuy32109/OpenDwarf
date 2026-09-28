import { type Browser, chromium, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

type Sample = {
  atMs: number;
  players: number;
  movingGuests: number;
  bytesSent: number;
  queuedBytes: number;
  routes: Record<string, number>;
  frameMeanMs: number;
  frameMaxMs: number;
  visualDeltas: { id: string; tiles: number }[];
  connections: HostStats["connections"];
};
type HostStats = {
  players: number;
  connections: {
    playerId: string;
    connected: boolean;
    route: string;
    bytesSent: number;
    bufferedAmount: number;
  }[];
};
type Position = {
  x: number;
  y: number;
  z: number;
  moveSequence: number | null;
};

const argumentsMap = new Map(Deno.args.map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const smoke = argumentsMap.has("smoke");
const durationSeconds = Number(
  argumentsMap.get("duration") ?? (smoke ? 12 : 900),
);
const count = Number(argumentsMap.get("count") ?? (smoke ? 2 : 20));
const rendered = Number(argumentsMap.get("rendered") ?? (smoke ? 1 : 4));
const delayMs = Number(argumentsMap.get("delay") ?? 50);
const jitterMs = Number(argumentsMap.get("jitter") ?? 0);
const loss = Number(argumentsMap.get("loss") ?? 0);
const seed = Number(argumentsMap.get("seed") ?? 1);
const worldEdge = Number(argumentsMap.get("world") ?? 16);
const baseUrl = argumentsMap.get("url") ?? "http://127.0.0.1:8000";
if (
  !Number.isInteger(count) || count < 1 || count > 100 ||
  !Number.isInteger(rendered) || rendered < 0 || rendered > 19 ||
  !Number.isFinite(durationSeconds) || durationSeconds <= 0 ||
  !Number.isFinite(delayMs) || delayMs < 0 || delayMs > 500 ||
  !Number.isFinite(jitterMs) || jitterMs < 0 || jitterMs > 200 ||
  !Number.isFinite(loss) || loss < 0 || loss > 0.2 ||
  !Number.isSafeInteger(seed) || seed < 1 ||
  (worldEdge !== 16 && worldEdge !== 32)
) throw new Error("Invalid stress arguments");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const revision = new Deno.Command("git", { args: ["rev-parse", "HEAD"] });
const gitRevision = new TextDecoder().decode((await revision.output()).stdout)
  .trim();
const worktree = new Deno.Command("git", { args: ["status", "--porcelain"] });
const isDirty = new TextDecoder().decode((await worktree.output()).stdout)
  .trim().length > 0;
const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[:.]/g, "-");
const output = `exports/stress/${runId}`;
await Deno.mkdir(output, { recursive: true });

let server: Deno.ChildProcess | null = null;
let browser: Browser | null = null;
/** @type {Sample[]} */
const samples: Sample[] = [];
/** @type {string[]} */
const failures: string[] = [];
const pages: { page: Page; id: string; rendered: boolean }[] = [];
const chatChecks: { kind: string; latencyMs: number; ok: boolean }[] = [];
const highSamples = new Map<string, number>();
const captureTasks: Promise<void>[] = [];
const captured: string[] = [];

async function startTrace(page: Page) {
  await page.evaluate(() => {
    const trace: Record<string, unknown>[] = [];
    (globalThis as unknown as { __stressTrace: Record<string, unknown>[] })
      .__stressTrace = trace;
    const frame = () => {
      const game = (globalThis as unknown as {
        __od: {
          scene: { localId: string };
          visualSample: (id: string) => unknown;
        };
      }).__od;
      trace.push({
        at: Date.now(),
        local: game.visualSample(game.scene.localId),
        host: game.visualSample("self"),
        npc: game.visualSample("npc-corner"),
      });
      if (trace.length > 300) trace.shift();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function captureOutlier(page: Page, id: string, atMs: number) {
  const directory = `${output}/outlier-${id.slice(5, 13)}-${atMs}`;
  try {
    await Deno.mkdir(directory, { recursive: true });
    const trace = await page.evaluate(() =>
      (globalThis as unknown as {
        __stressTrace: Record<string, unknown>[];
      }).__stressTrace
    );
    await Deno.writeTextFile(`${directory}/trace.json`, JSON.stringify(trace));
    for (let frame = 0; frame < 8; frame++) {
      await page.screenshot({
        path: `${directory}/frame-${String(frame).padStart(3, "0")}.png`,
      });
      await sleep(170);
    }
    const encode = new Deno.Command("ffmpeg", {
      args: [
        "-y",
        "-loglevel",
        "error",
        "-framerate",
        "4",
        "-i",
        `${directory}/frame-%03d.png`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        `${directory}/clip.mp4`,
      ],
      stdout: "null",
      stderr: "null",
    });
    const result = await encode.output();
    if (result.code !== 0) throw new Error(`ffmpeg exited ${result.code}`);
    captured.push(`${directory}/clip.mp4`);
  } catch (error) {
    failures.push(`outlier capture failed: ${String(error)}`);
  }
}

async function ready(url: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* Server is starting. */ }
    await sleep(250);
  }
  throw new Error(`Server unavailable: ${url}`);
}

async function waitForHarness(page: Page) {
  await page.waitForFunction(() =>
    Boolean(
      (globalThis as unknown as {
        __od?: unknown;
      }).__od,
    ), { timeout: 30_000 });
}

async function sample(host: Page, began: number) {
  const hostRead = host.evaluate(async () => {
    const game = (globalThis as unknown as {
      __od: {
        hostStats: () => Promise<HostStats>;
        frameStats: () => { meanMs: number; maxMs: number };
        authoritativeSample: (id: string) => Position | null;
      };
    }).__od;
    const positions = Object.fromEntries(
      Object.keys(
        (globalThis as unknown as {
          __od: { scene: { world: { players: Record<string, unknown> } } };
        }).__od.scene.world.players,
      ).map((id) => [
        id,
        game.authoritativeSample(id),
      ]),
    ) as Record<string, Position | null>;
    const stats = await game.hostStats();
    return {
      stats,
      frame: game.frameStats(),
      positions,
    };
  });
  const observerReads = pages.filter((entry) => entry.rendered).map(async (
    visitor,
  ) => ({
    id: visitor.id,
    observed: await visitor.page.evaluate(() => {
      const game = (globalThis as unknown as {
        __od: {
          scene: { localId: string };
          visualSample: (id: string) => Position | null;
        };
      }).__od;
      return game.visualSample(game.scene.localId);
    }),
  }));
  const [hostData, observers] = await Promise.all([
    hostRead,
    Promise.all(observerReads),
  ]);
  const routes: Record<string, number> = {};
  for (const connection of hostData.stats.connections) {
    if (!connection.connected) continue;
    routes[connection.route] = (routes[connection.route] ?? 0) + 1;
  }
  const visualDeltas: { id: string; tiles: number }[] = [];
  for (const { id, observed } of observers) {
    const expected = hostData.positions[id];
    if (!expected || expected.moveSequence === null) continue;
    if (!observed || observed.moveSequence !== expected.moveSequence) continue;
    visualDeltas.push({
      id,
      tiles: Math.hypot(
        expected.x - observed.x,
        expected.y - observed.y,
        expected.z - observed.z,
      ),
    });
  }
  const nowMs = Math.round(performance.now() - began);
  for (const delta of visualDeltas) {
    if (delta.tiles <= 0.25) {
      highSamples.delete(delta.id);
      continue;
    }
    const previous = highSamples.get(delta.id);
    if (
      previous !== undefined && nowMs - previous >= 100 &&
      nowMs - previous <= 1500 && captureTasks.length < 2
    ) {
      const observer = pages.find((entry) => entry.id === delta.id);
      if (observer) {
        captureTasks.push(captureOutlier(observer.page, delta.id, nowMs));
      }
    }
    highSamples.set(delta.id, nowMs);
  }
  samples.push({
    atMs: nowMs,
    players: hostData.stats.players,
    movingGuests: Object.entries(hostData.positions).filter(([id, player]) =>
      id.startsWith("peer-") && player !== null && player.moveSequence !== null
    ).length,
    bytesSent: hostData.stats.connections.reduce(
      (sum, connection) =>
        sum + connection.bytesSent,
      0,
    ),
    queuedBytes: hostData.stats.connections.reduce(
      (sum, connection) =>
        sum + connection.bufferedAmount,
      0,
    ),
    routes,
    frameMeanMs: hostData.frame.meanMs,
    frameMaxMs: hostData.frame.maxMs,
    visualDeltas,
    connections: hostData.stats.connections,
  });
}

async function waitForBubble(
  host: Page,
  id: string,
  field: "typing" | "hasMessage",
  expected: boolean,
) {
  const began = performance.now();
  try {
    await host.waitForFunction(
      ({ id, field, expected }) => {
        const game = (globalThis as unknown as {
          __od: {
            authoritativeSample: (id: string) => Record<string, unknown> | null;
          };
        }).__od;
        return game.authoritativeSample(id)?.[field] === expected;
      },
      { id, field, expected },
      { timeout: 3000, polling: 50 },
    );
    chatChecks.push({
      kind: `${field}:${expected}`,
      latencyMs: Math.round(performance.now() - began),
      ok: true,
    });
  } catch {
    chatChecks.push({
      kind: `${field}:${expected}`,
      latencyMs: Math.round(performance.now() - began),
      ok: false,
    });
  }
}

async function play(host: Page, until: number, began: number) {
  const directions = ["f", "d", "s", "e"];
  let turn = 0;
  while (performance.now() < until) {
    const active = [host, ...pages.map((entry) => entry.page)];
    await Promise.all(
      active.map((page, index) =>
        page.keyboard.down(directions[(turn + index) % directions.length])
      ),
    );
    await sleep(250);
    await sample(host, began);
    await sleep(300);
    await sample(host, began);
    await sleep(100);
    await Promise.all(
      active.map((page, index) =>
        page.keyboard.up(directions[(turn + index) % directions.length])
      ),
    );
    if (turn % 8 === 0 && pages.length) {
      const visitor = pages[turn / 8 % pages.length];
      const chatter = visitor.page;
      await chatter.evaluate(() => {
        (globalThis as unknown as { __od: { openChat: () => void } }).__od
          .openChat();
      });
      await chatter.keyboard.type("h", { delay: 90 });
      await waitForBubble(host, visitor.id, "typing", true);
      await chatter.keyboard.type("ello", { delay: 90 });
      if (turn % 16 === 0) {
        for (let i = 0; i < 5; i++) await chatter.keyboard.press("Backspace");
        await waitForBubble(host, visitor.id, "typing", false);
        await chatter.keyboard.press("Escape");
      } else {
        await chatter.keyboard.press("Enter");
        await waitForBubble(host, visitor.id, "hasMessage", true);
      }
      const ui = await chatter.evaluate(() => {
        const scene = (globalThis as unknown as {
          __od: { scene: { menu: boolean; chatOpen: boolean } };
        }).__od.scene;
        return { menu: scene.menu, chatOpen: scene.chatOpen };
      });
      if (ui.menu || ui.chatOpen) {
        failures.push(`guest UI remained open after chat at turn ${turn}`);
        if (ui.chatOpen || ui.menu) await chatter.keyboard.press("Escape");
      }
    }
    await sample(host, began);
    turn++;
    await sleep(350);
  }
}

try {
  if (!argumentsMap.has("url")) {
    server = new Deno.Command("deno", {
      args: ["task", "start"],
      stdout: "null",
      stderr: "null",
    }).spawn();
  }
  await ready(baseUrl);
  browser = await chromium.launch({
    headless: true,
    executablePath: existsSync("/usr/bin/chromium")
      ? "/usr/bin/chromium"
      : undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const host = await browser.newPage();
  host.on("pageerror", (error) => failures.push(`host: ${error.message}`));
  const conditions =
    `harness=1&delay=${delayMs}&jitter=${jitterMs}&loss=${loss}&seed=${seed}&telemetry=1&test=1`;
  await host.goto(
    `${baseUrl}/?${conditions}&world=${worldEdge}`,
  );
  await waitForHarness(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as {
      __od: { scene: { sessionId: string } };
    }).__od.scene.sessionId
  );
  const began = performance.now();
  for (let index = 0; index < count; index++) {
    const page = await browser.newPage();
    const usesWebGL = index < rendered;
    page.on(
      "pageerror",
      (error) => failures.push(`guest ${index + 1}: ${error.message}`),
    );
    await page.goto(
      `${baseUrl}/admin?${conditions}${usesWebGL ? "" : "&synthetic=1"}`,
    );
    await waitForHarness(page);
    await page.evaluate(
      (id) =>
        (globalThis as unknown as { __od: { join: (id: string) => void } }).__od
          .join(id),
      session,
    );
    try {
      await page.waitForFunction(() =>
        (globalThis as unknown as {
          __od: { scene: { localId: string } };
        }).__od.scene.localId.startsWith("peer-"), { timeout: 20_000 });
      const id = await page.evaluate(() =>
        (globalThis as unknown as {
          __od: { scene: { localId: string } };
        }).__od.scene.localId
      );
      pages.push({ page, id, rendered: usesWebGL });
      if (usesWebGL) await startTrace(page);
      if ([1, 5, 10, 20].includes(pages.length)) {
        console.log(`Joined ${pages.length} guests`);
        await sample(host, began);
      }
    } catch (error) {
      failures.push(`guest ${index + 1} join failed: ${String(error)}`);
      await page.close();
      break;
    }
  }
  const holdBegan = performance.now();
  const until = holdBegan + durationSeconds * 1000;
  await play(host, until, began);
  await sample(host, began);
  await Promise.all(captureTasks);
  const elapsed = (samples.at(-1)?.atMs ?? 0) / 1000;
  const sent = samples.map((item) => item.bytesSent);
  const rate = samples.slice(1).map((item, index) =>
    Math.max(0, item.bytesSent - samples[index].bytesSent) * 1000 /
    Math.max(1, item.atMs - samples[index].atMs)
  );
  const worstDelta = Math.max(
    0,
    ...samples.flatMap((item) => item.visualDeltas.map((delta) => delta.tiles)),
  );
  const visualOutliers = samples.flatMap((item) =>
    item.visualDeltas.filter((delta) => delta.tiles > 0.25).map((delta) => ({
      atMs: item.atMs,
      ...delta,
    }))
  );
  const holdSamples = samples.filter((item) =>
    item.atMs >= Math.round(holdBegan - began)
  );
  const movingMinutes = new Set(
    holdSamples.filter((item) => item.movingGuests > 0)
      .map((item) => Math.floor((item.atMs - (holdBegan - began)) / 60_000)),
  );
  const expectedMinutes = Math.ceil(durationSeconds / 60);
  if (movingMinutes.size < expectedMinutes) {
    failures.push(
      `guest movement absent in ${
        expectedMinutes - movingMinutes.size
      } hold minutes`,
    );
  }
  const holdRates = holdSamples.slice(1).map((item, index) =>
    Math.max(0, item.bytesSent - holdSamples[index].bytesSent) * 1000 /
    Math.max(1, item.atMs - holdSamples[index].atMs)
  );
  const peerTotals = pages.map((visitor) => {
    const values = samples.map((item) =>
      item.connections.find((connection) => connection.playerId === visitor.id)
        ?.bytesSent ?? 0
    );
    return values.at(-1) ?? 0;
  });
  const date = startedAt.toISOString().slice(0, 10);
  const report = `# Group stress run: ${date}

- Git revision: \`${gitRevision}\`${
    isDirty ? " (working tree had uncommitted changes)" : ""
  }
- Host machine: ${Deno.build.os}/${Deno.build.arch}; browser: Chromium ${browser.version()}.
- URL: \`${baseUrl}\`; session: \`${session}\`
- Profile: ${count} requested guests, ${pages.length} joined, ${
    Math.min(rendered, pages.length) + 1
  } WebGL pages including host, ${worldEdge}×${worldEdge} authored area, ${delayMs} ms application delivery delay each way.
- Jitter: ±${jitterMs} ms; app-message drop: ${
    (loss * 100).toFixed(1)
  }%; seed: ${seed}.
- Duration after ramp: ${durationSeconds} s; total elapsed: ${
    elapsed.toFixed(1)
  } s.
- Hold minutes with accepted guest movement: ${movingMinutes.size}/${expectedMinutes}.
- Host payload bytes sent: ${sent.at(-1) ?? 0} total; average ${
    (rate.reduce((sum, value) => sum + value, 0) / Math.max(1, rate.length))
      .toFixed(0)
  } B/s, peak ${Math.max(0, ...rate).toFixed(0)} B/s.
- Hold-only payload rate: average ${
    (holdRates.reduce((sum, value) => sum + value, 0) /
      Math.max(1, holdRates.length)).toFixed(0)
  } B/s, peak ${Math.max(0, ...holdRates).toFixed(0)} B/s; per-peer sent ${
    Math.min(...peerTotals)
  }–${Math.max(...peerTotals)} bytes.
- Peak queued bytes: ${Math.max(0, ...samples.map((item) => item.queuedBytes))}.
- Largest sampled accepted-move visual difference: ${
    worstDelta.toFixed(3)
  } tiles.
- Accepted-move samples above 0.25 tile: ${visualOutliers.length} (review adjacent timestamps for persistence over 100 ms).
- Failures: ${failures.length ? failures.join("; ") : "none observed"}.
- Chat checks: ${
    chatChecks.filter((check) => check.ok).length
  }/${chatChecks.length} passed; see raw event timings.
- Visual clips: ${
    captured.length
      ? captured.map((path) => `\`${path}\``).join(", ")
      : "none triggered"
  }.

This same-machine run estimates WebRTC data-channel payload, not external uplink.
The delay is applied at game-message delivery, not to ICE or physical packets.
Clip capture briefly adds work to the browser and may affect nearby frame samples.
Samples and page errors: \`${output}/samples.json\`.
`;
  await Deno.writeTextFile(
    `${output}/samples.json`,
    JSON.stringify(
      {
        revision: gitRevision,
        startedAt: startedAt.toISOString(),
        count,
        rendered,
        delayMs,
        jitterMs,
        loss,
        seed,
        worldEdge,
        samples,
        failures,
        chatChecks,
        captured,
      },
      null,
      2,
    ),
  );
  await Deno.writeTextFile(`${output}/report.md`, report);
  console.log(report);
  console.log(`Raw report: ${output}/report.md`);
} finally {
  await browser?.close();
  if (server) {
    server.kill("SIGTERM");
    await server.status;
  }
}
