import { chromium, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

type Position = { x: number; y: number; z: number; opacity?: number };
type ChatRecord = { id: string; text?: string; typing?: boolean };
type Connection = {
  playerId: string;
  connected: boolean;
  bytesSent: number;
  bufferedAmount: number;
  motionBufferedAmount?: number;
  motionBytesSent?: number;
  reliableBytesSent?: number;
};
type HostStats = {
  players: number;
  connections: Connection[];
  [key: string]: unknown;
};
type Harness = {
  scene: {
    sessionId: string;
    localId: string;
    viewMode: string;
    chatFeed?: ChatRecord[];
    world: {
      tick: number;
      edge: number;
      terrain: number[];
      players: Record<string, Position & Record<string, unknown>>;
    };
  };
  hostStats: () => Promise<HostStats>;
  frameStats: () => { meanMs: number; maxMs: number };
  visualSample: (id: string) => Position | null;
  authoritativeSample: (id: string) => Position | null;
  openChat: (text?: string) => void;
};
type Trace = { at: number; positions: Record<string, Position> };
type PageHarness = typeof globalThis & {
  __od: Harness;
  __motionBenchmarkTrace: Trace[];
  __motionBenchmarkStop: boolean;
};
const args = new Map(Deno.args.map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const allowed = new Set([
  "url",
  "count",
  "world",
  "rendered",
  "duration",
  "rate",
  "delay",
  "jitter",
  "loss",
  "seed",
  "view",
  "label",
]);
for (const key of args.keys()) {
  if (!allowed.has(key)) throw new Error(`Unknown argument --${key}`);
}
const url = args.get("url");
if (!url || !/^https?:\/\//.test(url)) {
  throw new Error(
    "Pass --url=http://127.0.0.1:<dedicated-port>; no server is started implicitly",
  );
}
const config = {
  url: url.replace(/\/$/, ""),
  count: Number(args.get("count") ?? 20),
  world: Number(args.get("world") ?? 16),
  rendered: Number(args.get("rendered") ?? 4),
  duration: Number(args.get("duration") ?? 60),
  rate: Number(args.get("rate") ?? 10),
  delay: Number(args.get("delay") ?? 50),
  jitter: Number(args.get("jitter") ?? 0),
  loss: Number(args.get("loss") ?? 0),
  seed: Number(args.get("seed") ?? 9),
  view: args.get("view") ?? "entity",
  label: args.get("label") ?? "working-tree",
};
if (
  !Number.isInteger(config.count) || config.count < 1 || config.count > 20 ||
  ![16, 32].includes(config.world) ||
  !Number.isInteger(config.rendered) || config.rendered < 0 ||
  config.rendered > config.count ||
  !Number.isFinite(config.duration) || config.duration < 1 ||
  ![10, 20].includes(config.rate) ||
  !Number.isFinite(config.delay) || config.delay < 0 || config.delay > 500 ||
  !Number.isFinite(config.jitter) || config.jitter < 0 || config.jitter > 200 ||
  !Number.isFinite(config.loss) || config.loss < 0 || config.loss > .2 ||
  !Number.isSafeInteger(config.seed) || config.seed < 1 ||
  !["entity", "master"].includes(config.view)
) throw new Error("Invalid benchmark arguments");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values: number[], p: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ??
    0;
};
const revision = new TextDecoder().decode(
  (await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
  }).output()).stdout,
).trim();
const dirty = new TextDecoder().decode(
  (await new Deno.Command("git", {
    args: ["status", "--porcelain"],
  }).output()).stdout,
).trim().length > 0;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = `exports/benchmarks/${runId}`;
await Deno.mkdir(output, { recursive: true });
const failures: string[] = [];
const chatChecks: { kind: string; ok: boolean; latencyMs: number }[] = [];
const samples: {
  at: number;
  stats: HostStats;
  frame: { meanMs: number; maxMs: number };
}[] = [];
const guests: { page: Page; id: string; rendered: boolean }[] = [];
const browser = await chromium.launch({
  executablePath: existsSync("/usr/bin/chromium")
    ? "/usr/bin/chromium"
    : undefined,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
async function harness(page: Page) {
  await page.waitForFunction(() => Boolean((globalThis as PageHarness).__od), {
    timeout: 30_000,
  });
}
async function trace(page: Page, authoritative: boolean) {
  await page.evaluate(({ authoritative }) => {
    const root = globalThis as PageHarness;
    root.__motionBenchmarkTrace = [];
    root.__motionBenchmarkStop = false;
    let previous = 0;
    const frame = () => {
      if (root.__motionBenchmarkStop) return;
      const at = Date.now();
      if (at - previous >= 45) {
        previous = at;
        const positions: Record<string, Position> = {};
        for (const id of Object.keys(root.__od.scene.world.players)) {
          const sample = authoritative
            ? root.__od.authoritativeSample(id)
            : root.__od.visualSample(id);
          if (sample && (sample.opacity === undefined || sample.opacity > 0)) {
            positions[id] = { x: sample.x, y: sample.y, z: sample.z };
          }
        }
        root.__motionBenchmarkTrace.push({ at, positions });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, { authoritative });
}
async function collect(host: Page) {
  samples.push(
    await host.evaluate(async () => ({
      at: Date.now(),
      stats: await (globalThis as PageHarness).__od.hostStats(),
      frame: (globalThis as PageHarness).__od.frameStats(),
    })),
  );
}
async function chatCheck(host: Page) {
  const speaker = guests[0];
  if (!speaker) return;
  await speaker.page.evaluate(() =>
    (globalThis as PageHarness).__od.openChat()
  );
  const began = performance.now();
  await speaker.page.keyboard.type("benchmark");
  try {
    await host.waitForFunction(
      (id) => {
        const game = (globalThis as PageHarness).__od;
        return game.scene.chatFeed?.some((record) =>
          record.id === id && record.typing
        ) ??
          Boolean(game.scene.world.players[id]?.typing);
      },
      speaker.id,
      { timeout: 5_000 },
    );
    chatChecks.push({
      kind: "typing-to-host",
      ok: true,
      latencyMs: performance.now() - began,
    });
  } catch {
    chatChecks.push({
      kind: "typing-to-host",
      ok: false,
      latencyMs: performance.now() - began,
    });
  }
  await speaker.page.keyboard.press("Enter");
  const sent = performance.now();
  for (
    const [kind, page] of [["message-to-host", host], [
      "message-to-own-feed",
      speaker.page,
    ]] as const
  ) {
    try {
      await page.waitForFunction(
        (id) => {
          const game = (globalThis as PageHarness).__od;
          return game.scene.chatFeed?.some((record) =>
            record.id === id && record.text === "benchmark"
          ) ||
            game.scene.world.players[id]?.message === "benchmark";
        },
        speaker.id,
        { timeout: 5_000 },
      );
      chatChecks.push({ kind, ok: true, latencyMs: performance.now() - sent });
    } catch {
      chatChecks.push({ kind, ok: false, latencyMs: performance.now() - sent });
    }
  }
}
try {
  const response = await fetch(config.url);
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  await response.body?.cancel();
  const host = await browser.newPage();
  host.on("pageerror", (error) => failures.push(`host: ${error.message}`));
  const conditions =
    `harness=1&delay=${config.delay}&jitter=${config.jitter}&loss=${config.loss}&seed=${config.seed}&motionHz=${config.rate}`;
  await host.goto(`${config.url}/?${conditions}&world=${config.world}`);
  await harness(host);
  const session = await host.evaluate(() =>
    (globalThis as PageHarness).__od.scene.sessionId
  );
  for (let i = 0; i < config.count; i++) {
    const page = await browser.newPage();
    page.on(
      "pageerror",
      (error) => failures.push(`guest${i + 1}: ${error.message}`),
    );
    await page.goto(
      `${config.url}/join/${session}?${conditions}${
        i < config.rendered ? "" : "&synthetic=1"
      }`,
    );
    await harness(page);
    await page.waitForFunction(
      () => (globalThis as PageHarness).__od.scene.localId.startsWith("peer-"),
      { timeout: 30_000 },
    );
    const id = await page.evaluate(() =>
      (globalThis as PageHarness).__od.scene.localId
    );
    guests.push({ page, id, rendered: i < config.rendered });
    if ([1, 5, 10, 20].includes(guests.length)) {
      console.log(`Joined ${guests.length}/${config.count}`);
    }
  }
  const locations = await host.evaluate((ids) => {
    const world = (globalThis as PageHarness).__od.scene.world;
    delete world.players["npc-corner"];
    const cells: { id: string; x: number; y: number }[] = [];
    for (let y = 1; y < 12 && cells.length < ids.length; y += 2.5) {
      for (let x = 1; x < 14 && cells.length < ids.length; x += 2.5) {
        let safe = true;
        for (let cy = Math.floor(y - .25); cy <= Math.ceil(y + 1.4); cy++) {
          for (let cx = Math.floor(x - .25); cx <= Math.ceil(x + 1.4); cx++) {
            if (world.terrain[cy * world.edge + cx] !== 1) safe = false;
          }
        }
        if (!safe) continue;
        const id = ids[cells.length];
        Object.assign(world.players[id], {
          x,
          y,
          z: 0,
          previousX: x,
          previousY: y,
          move: null,
          vx: 0,
          vy: 0,
        });
        cells.push({ id, x, y });
      }
    }
    if (cells.length !== ids.length) {
      throw new Error("Not enough separated safe paths");
    }
    return cells;
  }, ["self", ...guests.map((guest) => guest.id)]);
  await sleep(1_200);
  if (config.view === "master") {
    for (const page of [host, ...guests.map((guest) => guest.page)]) {
      await page.evaluate(() =>
        (globalThis as PageHarness).__od.openChat("/master")
      );
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => (globalThis as PageHarness).__od.scene.viewMode === "master",
        { timeout: 10_000 },
      );
    }
  }
  await chatCheck(host);
  await trace(host, true);
  await Promise.all(
    guests.filter((guest) => guest.rendered).map((guest) =>
      trace(guest.page, false)
    ),
  );
  await collect(host);
  const began = Date.now();
  const directions = ["f", "d", "s", "e"];
  const active = [host, ...guests.map((guest) => guest.page)];
  let turn = 0;
  let lastProgress = began;
  while (Date.now() - began < config.duration * 1_000) {
    const key = directions[turn % 4];
    await Promise.all(active.map((page) => page.keyboard.down(key)));
    await sleep(300);
    await Promise.all(active.map((page) => page.keyboard.up(key)));
    await collect(host);
    if (Date.now() - lastProgress >= 15_000) {
      console.log(
        `Held movement ${
          (Date.now() - began) / 1_000 | 0
        }s; ${guests.length} peers`,
      );
      lastProgress = Date.now();
    }
    turn++;
  }
  await sleep(600);
  await collect(host);
  const hostTrace = await host.evaluate(() => {
    const root = globalThis as PageHarness;
    root.__motionBenchmarkStop = true;
    return root.__motionBenchmarkTrace;
  });
  const observerTraces = await Promise.all(
    guests.filter((guest) => guest.rendered).map(async (guest) => ({
      id: guest.id,
      frames: await guest.page.evaluate(() => {
        const root = globalThis as PageHarness;
        root.__motionBenchmarkStop = true;
        return root.__motionBenchmarkTrace;
      }),
    })),
  );
  const distance = (a: Position, b: Position) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  let movingIntervals = 0;
  const movingPeers = new Set<string>();
  for (let i = 1; i < hostTrace.length; i++) {
    for (const [id, position] of Object.entries(hostTrace[i].positions)) {
      const prior = hostTrace[i - 1].positions[id];
      if (prior && distance(position, prior) > .002) {
        movingIntervals++;
        if (id.startsWith("peer-")) movingPeers.add(id);
      }
    }
  }
  if (movingPeers.size !== config.count) {
    failures.push(`Only ${movingPeers.size}/${config.count} peers moved`);
  }
  const visual = observerTraces.map((observer) => {
    let matched = 0, pauses = 0, steps = 0, sampleGaps = 0;
    const rawLag: number[] = [];
    const presentationAlignedError: number[] = [];
    let cursor = 0;
    for (let i = 1; i < observer.frames.length; i++) {
      const frame = observer.frames[i];
      const priorFrame = observer.frames[i - 1];
      const interval = frame.at - priorFrame.at;
      if (interval > 200) {
        sampleGaps++;
        continue;
      }
      while (
        cursor + 1 < hostTrace.length && hostTrace[cursor + 1].at <= frame.at
      ) cursor++;
      const current = hostTrace[cursor];
      const previous = hostTrace[Math.max(0, cursor - 1)];
      let delayedIndex = cursor;
      while (delayedIndex > 0 && hostTrace[delayedIndex].at > frame.at - 150) {
        delayedIndex--;
      }
      const delayed = hostTrace[delayedIndex];
      for (const [id, position] of Object.entries(frame.positions)) {
        if (id === observer.id) continue;
        const last = priorFrame.positions[id];
        const expected = current?.positions[id];
        const priorExpected = previous?.positions[id];
        const delayedExpected = delayed?.positions[id];
        if (
          !last || !expected || !priorExpected ||
          Math.abs(current.at - frame.at) > 150
        ) continue;
        matched++;
        rawLag.push(distance(position, expected));
        if (delayedExpected) {
          presentationAlignedError.push(distance(position, delayedExpected));
        }
        const delta = distance(position, last);
        if (distance(expected, priorExpected) > .02 && delta < .002) pauses++;
        // Continuous walking is 2.8 tiles/s; steps over twice that speed are recorded.
        if (delta > Math.max(.15, interval / 1_000 * 2.8 * 2)) steps++;
      }
    }
    return {
      observer: observer.id,
      matched,
      pauses,
      steps,
      sampleGaps,
      rawLagTilesP95: percentile(rawLag, .95),
      presentationAlignedErrorTilesP95: percentile(
        presentationAlignedError,
        .95,
      ),
    };
  });
  const first = samples[0];
  const last = samples.at(-1)!;
  const elapsed = (last.at - first.at) / 1_000;
  const bytes = (sample: typeof first) =>
    sample.stats.connections.reduce((sum, item) => sum + item.bytesSent, 0);
  const queue = (sample: typeof first) =>
    sample.stats.connections.reduce(
      (sum, item) =>
        sum + item.bufferedAmount + (item.motionBufferedAmount ?? 0),
      0,
    );
  const lostConnections = samples.filter((sample) =>
    sample.stats.connections.filter((item) =>
      item.connected
    ).length !== config.count
  ).length;
  if (lostConnections) {
    failures.push(`${lostConnections} samples had fewer connected peers`);
  }
  const report = {
    config,
    revision,
    dirty,
    browser: browser.version(),
    locations,
    joined: guests.length,
    elapsedSeconds: elapsed,
    payloadBytes: bytes(last) - bytes(first),
    payloadBytesPerSecond: (bytes(last) - bytes(first)) / elapsed,
    peakQueuedBytes: Math.max(...samples.map(queue)),
    hostFrameMeanP50Ms: percentile(
      samples.map((sample) => sample.frame.meanMs),
      .5,
    ),
    hostFrameMeanP95Ms: percentile(
      samples.map((sample) => sample.frame.meanMs),
      .95,
    ),
    hostLongestFrameMs: Math.max(
      ...samples.map((sample) => sample.frame.maxMs),
    ),
    movingPeers: movingPeers.size,
    movingIntervals,
    lostConnections,
    visual,
    chatChecks,
    failures,
    samples,
    hostTrace,
    observerTraces,
  };
  await Deno.writeTextFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2),
  );
  const markdown =
    `# Motion benchmark ${runId}\n\nLabel: ${config.label}; revision: ${revision}${
      dirty ? " (dirty)" : ""
    }.\n\n${guests.length} guests, host plus ${config.rendered} rendered guests, ${config.world}×${config.world}, ${config.view} view, requested ${config.rate} Hz. Hold ${
      elapsed.toFixed(1)
    } s; delay ${config.delay} ms, jitter ±${config.jitter} ms, application-message loss ${config.loss}, seed ${config.seed}.\n\nPayload ${
      (report.payloadBytesPerSecond / 1_000).toFixed(1)
    } kB/s; peak queue ${report.peakQueuedBytes} B. Host rolling mean frame p50/p95 ${
      report.hostFrameMeanP50Ms.toFixed(1)
    }/${report.hostFrameMeanP95Ms.toFixed(1)} ms; longest ${
      report.hostLongestFrameMs.toFixed(1)
    } ms. All ${movingPeers.size}/${config.count} peers moved; ${movingIntervals} actual x/y movement intervals.\n\n| Observer | Pairs | Pauses during host movement | Fast steps | Raw lag p95 (tiles) | 150 ms aligned error p95 (tiles) | Sampling gaps |\n|---|---:|---:|---:|---:|---:|---:|\n${
      visual.map((item) =>
        `| ${item.observer} | ${item.matched} | ${item.pauses} | ${item.steps} | ${
          item.rawLagTilesP95.toFixed(3)
        } | ${
          item.presentationAlignedErrorTilesP95.toFixed(3)
        } | ${item.sampleGaps} |`
      ).join("\n")
    }\n\nChat checks: ${
      chatChecks.filter((check) => check.ok).length
    }/${chatChecks.length}. Failures: ${
      failures.length ? failures.join("; ") : "none"
    }.\n\nRaw lag includes intended presentation delay and transport delay. Pauses and fast steps are diagnostic counts, not pass/fail thresholds; frame sampling gaps above 200 ms are excluded. This same-machine test measures data-channel payload and application delivery loss, not physical uplink or SCTP packet loss. The requested rate requires the server's motionHz harness support; baseline ignores it. Raw traces, channel counters, and build timings are in report.json.\n`;
  await Deno.writeTextFile(`${output}/report.md`, markdown);
  console.log(
    `${config.label}: ${
      report.payloadBytesPerSecond.toFixed(0)
    } B/s, frame p95 ${
      report.hostFrameMeanP95Ms.toFixed(1)
    }ms, ${movingPeers.size}/${config.count} moving peers; ${failures.length} failures. ${output}/report.md`,
  );
} catch (error) {
  failures.push(String(error));
  await Deno.writeTextFile(
    `${output}/report.json`,
    JSON.stringify(
      { config, revision, failures, samples, joined: guests.length },
      null,
      2,
    ),
  );
  await Deno.writeTextFile(
    `${output}/report.md`,
    `# Interrupted benchmark\n\n${failures.join("\n")}\n`,
  );
  throw error;
} finally {
  await browser.close();
}
