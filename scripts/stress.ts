import { type Browser, chromium, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

type Sample = {
  atMs: number;
  wallAtMs: number;
  players: number;
  movingGuests: number;
  bytesSent: number;
  queuedBytes: number;
  routes: Record<string, number>;
  frameMeanMs: number;
  frameMaxMs: number;
  visualDeltas: {
    id: string;
    observer: string;
    target: string;
    tiles: number;
    skewMs: number;
    expected: Position;
    observed: Position;
  }[];
  localPredictionDeltas: { id: string; tiles: number; skewMs: number }[];
  skippedSkew: number;
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
  opacity?: number;
  tick?: number;
  motion?: {
    startPosition: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    startTick: number;
    durationTicks: number;
  } | null;
};

function alignedPosition(position: Position, skewMs: number): Position {
  const motion = position.motion;
  if (!motion || position.tick === undefined) return position;
  const alpha = Math.max(
    0,
    Math.min(
      1,
      (position.tick + skewMs / 50 - motion.startTick) / motion.durationTicks,
    ),
  );
  return {
    ...position,
    x: motion.startPosition.x +
      (motion.target.x - motion.startPosition.x) * alpha,
    y: motion.startPosition.y +
      (motion.target.y - motion.startPosition.y) * alpha,
    z: motion.startPosition.z +
      (motion.target.z - motion.startPosition.z) * alpha,
  };
}

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
  !Number.isSafeInteger(count) || count < 1 ||
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
const sustainedVisualOutliers: { atMs: number; id: string; tiles: number }[] =
  [];
const captureTasks: Promise<void>[] = [];
const captured: string[] = [];

async function startTrace(page: Page) {
  await page.evaluate(() => {
    const trace: Record<string, unknown>[] = [];
    (globalThis as unknown as { __stressTrace: Record<string, unknown>[] })
      .__stressTrace = trace;
    const opacityAnomalies: {
      at: number;
      id: string;
      from: number;
      to: number;
    }[] = [];
    (globalThis as unknown as {
      __stressOpacityAnomalies: typeof opacityAnomalies;
    }).__stressOpacityAnomalies = opacityAnomalies;
    const previous = new Map<
      string,
      { at: number; opacity: number; sight: string }
    >();
    const frame = () => {
      const game = (globalThis as unknown as {
        __od: {
          scene: { localId: string };
          visualSample: (
            id: string,
          ) => { opacity: number; sight: string } | null;
        };
      }).__od;
      const at = Date.now();
      const current = {
        local: game.visualSample(game.scene.localId),
        host: game.visualSample("self"),
        npc: game.visualSample("npc-corner"),
      };
      for (const [id, value] of Object.entries(current)) {
        if (!value) continue;
        const prior = previous.get(id);
        if (
          prior && prior.sight === value.sight && at - prior.at < 250 &&
          Math.abs(value.opacity - prior.opacity) > 0.5 &&
          opacityAnomalies.length < 100
        ) {
          opacityAnomalies.push({
            at,
            id,
            from: prior.opacity,
            to: value.opacity,
          });
        }
        previous.set(id, { at, opacity: value.opacity, sight: value.sight });
      }
      trace.push({ at, ...current });
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

async function collectSample(host: Page, began: number) {
  const hostRead = host.evaluate(async () => {
    const game = (globalThis as unknown as {
      __od: {
        hostStats: () => Promise<HostStats>;
        frameStats: () => { meanMs: number; maxMs: number };
        authoritativeSample: (id: string) => Position | null;
        visualSample: (id: string) => Position | null;
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
    const visuals = Object.fromEntries(
      Object.keys(positions).map((id) => [id, game.visualSample(id)]),
    ) as Record<string, Position | null>;
    const at = Date.now();
    const stats = await game.hostStats();
    return {
      stats,
      frame: game.frameStats(),
      positions,
      visuals,
      at,
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
      return {
        at: Date.now(),
        local: game.visualSample(game.scene.localId),
        host: game.visualSample("self"),
      };
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
  const visualDeltas: Sample["visualDeltas"] = [];
  const localPredictionDeltas: Sample["localPredictionDeltas"] = [];
  let skippedSkew = 0;
  for (const connection of hostData.stats.connections) {
    const target = connection.playerId;
    const expected = hostData.positions[target];
    const observed = hostData.visuals[target];
    if (
      !expected || !observed || observed.opacity === 0 ||
      expected.moveSequence === null ||
      observed.moveSequence !== expected.moveSequence
    ) continue;
    visualDeltas.push({
      id: `host:${target}`,
      observer: "host",
      target,
      skewMs: 0,
      expected,
      observed,
      tiles: Math.hypot(
        expected.x - observed.x,
        expected.y - observed.y,
        expected.z - observed.z,
      ),
    });
  }
  for (const { id, observed } of observers) {
    const skewMs = observed.at - hostData.at;
    if (Math.abs(skewMs) > 200) {
      skippedSkew++;
      continue;
    }
    const hostExpected = hostData.positions.self;
    if (
      hostExpected && hostExpected.moveSequence !== null && observed.host &&
      observed.host.opacity !== 0 &&
      observed.host.moveSequence === hostExpected.moveSequence
    ) {
      const aligned = alignedPosition(hostExpected, skewMs);
      visualDeltas.push({
        id: `${id}:self`,
        observer: id,
        target: "self",
        skewMs,
        expected: aligned,
        observed: observed.host,
        tiles: Math.hypot(
          aligned.x - observed.host.x,
          aligned.y - observed.host.y,
          aligned.z - observed.host.z,
        ),
      });
    }
    const localExpected = hostData.positions[id];
    if (
      localExpected && localExpected.moveSequence !== null && observed.local &&
      observed.local.moveSequence === localExpected.moveSequence
    ) {
      const aligned = alignedPosition(localExpected, skewMs);
      localPredictionDeltas.push({
        id,
        skewMs,
        tiles: Math.hypot(
          aligned.x - observed.local.x,
          aligned.y - observed.local.y,
          aligned.z - observed.local.z,
        ),
      });
    }
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
      nowMs - previous <= 1500
    ) {
      sustainedVisualOutliers.push({ atMs: nowMs, ...delta });
      if (captureTasks.length < 2) {
        const observer = delta.observer === "host"
          ? host
          : pages.find((entry) => entry.id === delta.observer)?.page;
        if (observer) {
          captureTasks.push(captureOutlier(observer, delta.id, nowMs));
        }
      }
    }
    highSamples.set(delta.id, nowMs);
  }
  samples.push({
    atMs: nowMs,
    wallAtMs: Date.now(),
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
    localPredictionDeltas,
    skippedSkew,
    connections: hostData.stats.connections,
  });
}

async function sample(host: Page, began: number) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  try {
    await Promise.race([
      collectSample(host, began),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("host sample timed out")),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  let nextProgress = began + 60_000;
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
    if (performance.now() >= nextProgress) {
      const latest = samples.at(-1);
      console.log(
        `Minute ${
          Math.floor((performance.now() - began) / 60_000)
        }: ${pages.length} guests, ${latest?.movingGuests ?? 0} moving, ${
          latest?.queuedBytes ?? 0
        } bytes queued`,
      );
      nextProgress += 60_000;
    }
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
  let growingQueue = 0;
  let priorQueued = 0;
  for (let index = 0; index < count; index++) {
    const page = await browser.newPage();
    const usesWebGL = index < rendered;
    page.on(
      "pageerror",
      (error) => failures.push(`guest ${index + 1}: ${error.message}`),
    );
    await page.goto(
      `${baseUrl}/join/${session}?${conditions}${
        usesWebGL ? "" : "&synthetic=1"
      }`,
    );
    await waitForHarness(page);
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
      await sample(host, began);
      if ([1, 5, 10, 20].includes(pages.length)) {
        console.log(`Joined ${pages.length} guests`);
      }
      const queued = samples.at(-1)?.queuedBytes ?? 0;
      growingQueue = queued > 1024 * 1024 && queued >= priorQueued
        ? growingQueue + 1
        : 0;
      priorQueued = queued;
      if (growingQueue >= 3) {
        failures.push(
          `host queue did not drain while adding guest ${pages.length}`,
        );
        break;
      }
    } catch (error) {
      failures.push(`guest ${index + 1} join failed: ${String(error)}`);
      await page.close();
      break;
    }
  }
  const holdBegan = performance.now();
  const holdBeganWall = Date.now();
  const until = holdBegan + durationSeconds * 1000;
  await play(host, until, began);
  await sample(host, began);
  await Promise.all(captureTasks);
  const opacityAnomalies = (await Promise.all(
    pages.filter((entry) => entry.rendered).map(async (entry) => ({
      id: entry.id,
      events: await entry.page.evaluate(() =>
        (globalThis as unknown as {
          __stressOpacityAnomalies: {
            at: number;
            id: string;
            from: number;
            to: number;
          }[];
        }).__stressOpacityAnomalies
      ),
    })),
  )).flatMap((entry) =>
    entry.events.map((event) => ({ observer: entry.id, ...event }))
  );
  const elapsed = (samples.at(-1)?.atMs ?? 0) / 1000;
  /** @param {Sample} before @param {Sample} after */
  const bytesBetween = (before: Sample, after: Sample) => {
    const old = new Map(before.connections.map((connection) => [
      connection.playerId,
      connection.bytesSent,
    ]));
    return after.connections.reduce((sum, connection) => {
      const prior = old.get(connection.playerId) ?? 0;
      return sum +
        (connection.bytesSent >= prior
          ? connection.bytesSent - prior
          : connection.bytesSent);
    }, 0);
  };
  const intervalBytes = samples.slice(1).map((item, index) =>
    bytesBetween(samples[index], item)
  );
  const totalSent = (samples[0]?.bytesSent ?? 0) +
    intervalBytes.reduce((sum, value) => sum + value, 0);
  const rate = intervalBytes.map((value, index) =>
    value * 1000 / Math.max(1, samples[index + 1].atMs - samples[index].atMs)
  );
  const worstDelta = Math.max(
    0,
    ...samples.flatMap((item) => item.visualDeltas.map((delta) => delta.tiles)),
  );
  const localPredictionPairs = samples.reduce(
    (sum, item) => sum + item.localPredictionDeltas.length,
    0,
  );
  const largestPredictionLead = Math.max(
    0,
    ...samples.flatMap((item) =>
      item.localPredictionDeltas.map((delta) => delta.tiles)
    ),
  );
  const visualPairs = samples.reduce(
    (sum, item) => sum + item.visualDeltas.length,
    0,
  );
  const skippedSkew = samples.reduce((sum, item) => sum + item.skippedSkew, 0);
  const visualOutliers = samples.flatMap((item) =>
    item.visualDeltas.filter((delta) => delta.tiles > 0.25).map((delta) => ({
      atMs: item.atMs,
      ...delta,
    }))
  );
  const holdSamples = samples.filter((item) =>
    item.atMs >= Math.round(holdBegan - began)
  );
  const wallHoldSeconds = (Date.now() - holdBeganWall) / 1000;
  const maxWallGapMs = Math.max(
    0,
    ...samples.slice(1).map((item, index) =>
      item.wallAtMs - samples[index].wallAtMs
    ),
  );
  if (wallHoldSeconds > durationSeconds + 30) {
    failures.push(`wall-clock interruption: ${wallHoldSeconds.toFixed(1)} s`);
  }
  const movingMinutes = new Set(
    holdSamples.filter((item) => item.movingGuests > 0)
      .map((item) => Math.floor((item.atMs - (holdBegan - began)) / 60_000))
      .filter((minute) =>
        minute >= 0 && minute < Math.ceil(durationSeconds / 60)
      ),
  );
  const expectedMinutes = Math.ceil(durationSeconds / 60);
  if (movingMinutes.size < expectedMinutes) {
    failures.push(
      `guest movement absent in ${
        expectedMinutes - movingMinutes.size
      } hold minutes`,
    );
  }
  const holdIntervalBytes = holdSamples.slice(1).map((item, index) =>
    bytesBetween(holdSamples[index], item)
  );
  const holdRates = holdIntervalBytes.map((value, index) =>
    value * 1000 /
    Math.max(1, holdSamples[index + 1].atMs - holdSamples[index].atMs)
  );
  const peerTotals = pages.map((visitor) => {
    const first = samples[0]?.connections.find((connection) =>
      connection.playerId === visitor.id
    )?.bytesSent ?? 0;
    const later = samples.slice(1).reduce((sum, item, index) => {
      const current = item.connections.find((connection) =>
        connection.playerId === visitor.id
      )?.bytesSent ?? 0;
      const prior = samples[index].connections.find((connection) =>
        connection.playerId === visitor.id
      )?.bytesSent ?? 0;
      return sum + (current >= prior ? current - prior : current);
    }, 0);
    return first + later;
  });
  const counterResets = samples.slice(1).reduce((sum, item, index) => {
    const previous = new Map(samples[index].connections.map((connection) => [
      connection.playerId,
      connection.bytesSent,
    ]));
    return sum +
      item.connections.filter((connection) =>
        connection.bytesSent < (previous.get(connection.playerId) ?? 0)
      ).length;
  }, 0);
  const frameMeans = samples.map((item) => item.frameMeanMs).sort((a, b) =>
    a - b
  );
  const frameP95 = frameMeans[Math.floor(frameMeans.length * 0.95)] ?? 0;
  const chatLatencies = chatChecks.filter((check) => check.ok).map((check) =>
    check.latencyMs
  ).sort((a, b) => a - b);
  const chatP95 = chatLatencies[Math.floor(chatLatencies.length * 0.95)] ?? 0;
  const date = startedAt.toISOString().slice(0, 10);
  const report = `# Group stress run: ${date}

- Git revision: \`${gitRevision}\`${
    isDirty ? " (working tree had uncommitted changes)" : ""
  }
- Host machine: ${Deno.build.os}/${Deno.build.arch}; browser: Chromium ${browser.version()}.
- URL: \`${baseUrl}\`; session: \`${session}\`
- Profile: ${count} requested guests, ${pages.length} joined, ${
    Math.min(rendered, pages.length) + 1
  } WebGL pages including host, direct guest links, ${worldEdge}×${worldEdge} authored area, ${delayMs} ms application delivery delay each way.
- Jitter: ±${jitterMs} ms; app-message drop: ${
    (loss * 100).toFixed(1)
  }%; seed: ${seed}.
- Duration after ramp: ${durationSeconds} s; total elapsed: ${
    elapsed.toFixed(1)
  } s of simulation time; wall-clock hold ${wallHoldSeconds.toFixed(1)} s.
- Largest gap between wall-clock samples: ${maxWallGapMs} ms; data-channel counter resets: ${counterResets}.
- Hold minutes with accepted guest movement: ${movingMinutes.size}/${expectedMinutes}.
- Host payload bytes sent: ${totalSent} total across data-channel resets; average ${
    (totalSent * 1000 / Math.max(1, elapsed * 1000)).toFixed(0)
  } B/s, peak ${Math.max(0, ...rate).toFixed(0)} B/s.
- Hold-only payload rate: average ${
    (holdIntervalBytes.reduce((sum, value) => sum + value, 0) * 1000 /
      Math.max(
        1,
        (holdSamples.at(-1)?.atMs ?? 0) -
          (holdSamples[0]?.atMs ?? 0),
      )).toFixed(0)
  } B/s, peak ${Math.max(0, ...holdRates).toFixed(0)} B/s; per-peer sent ${
    Math.min(...peerTotals)
  }–${Math.max(...peerTotals)} bytes.
- Peak queued bytes: ${Math.max(0, ...samples.map((item) => item.queuedBytes))}.
- Host rolling mean frame time: median ${
    (frameMeans[Math.floor(frameMeans.length / 2)] ?? 0).toFixed(1)
  } ms, p95 ${frameP95.toFixed(1)} ms; longest recorded single frame ${
    Math.max(0, ...samples.map((item) => item.frameMaxMs)).toFixed(1)
  } ms.
- Largest sampled remote-sprite difference from host authority: ${
    worstDelta.toFixed(3)
  } tiles.
- Local prediction lead: ${localPredictionPairs} comparable samples, maximum ${
    largestPredictionLead.toFixed(3)
  } tiles. This is reported separately from remote visual sync.
- Comparable accepted-move visual pairs: ${visualPairs}; ${skippedSkew} pairs skipped for over 200 ms sample-time skew. Host moves are aligned to observer time.
- Accepted-move samples above 0.25 tile: ${visualOutliers.length} (review adjacent timestamps for persistence over 100 ms).
- Repeated accepted-move outlier candidates over 100 ms apart: ${sustainedVisualOutliers.length}; rejected-move corrections excluded.
- Failures: ${failures.length ? failures.join("; ") : "none observed"}.
- Chat checks: ${
    chatChecks.filter((check) => check.ok).length
  }/${chatChecks.length} passed; p95 observed bubble latency ${chatP95} ms. See raw event timings.
- Visual clips: ${
    captured.length
      ? captured.map((path) => `\`${path}\``).join(", ")
      : "none triggered"
  }.
- Opacity jumps without a sight change: ${opacityAnomalies.length} (sampled local, host, and NPC sprites).

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
        sustainedVisualOutliers,
        opacityAnomalies,
      },
      null,
      2,
    ),
  );
  await Deno.writeTextFile(`${output}/report.md`, report);
  console.log(report);
  console.log(`Raw report: ${output}/report.md`);
} catch (error) {
  const reason = String(error);
  failures.push(`fatal: ${reason}`);
  await Deno.writeTextFile(
    `${output}/fatal.md`,
    `# Interrupted group stress run\n\nRevision: \`${gitRevision}\`\n\nJoined guests: ${pages.length}/${count}\n\nReason: ${reason}\n\nRecent samples: \`${output}/partial.json\`\n`,
  );
  await Deno.writeTextFile(
    `${output}/partial.json`,
    JSON.stringify({ samples, failures, chatChecks }, null, 2),
  );
  throw error;
} finally {
  try {
    await browser?.close();
  } catch { /* The browser may already have crashed. */ }
  if (server) {
    server.kill("SIGTERM");
    await server.status;
  }
}
