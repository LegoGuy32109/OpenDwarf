import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  createFrameStats,
  frameLine,
  RING_SIZE,
  SPIKE_LOG_SIZE,
  spikeMetrics,
  summaryMetrics,
} from "../../src/client/frame-stats.js";

const info = { viewMode: "entity", zoom: 1, chunks: 12 };

/** Feed frames of the given lengths, starting at time 0. */
function feed(stats: ReturnType<typeof createFrameStats>, lengths: number[]) {
  let now = 1000;
  stats.frame(now, info);
  for (const length of lengths) {
    now += length;
    stats.frame(now, info);
  }
  return now;
}

Deno.test("the ring gives percentiles over the frames it holds", () => {
  const stats = createFrameStats({ observer: null });
  feed(stats, Array.from({ length: 100 }, (_, index) => index + 1));
  const snapshot = stats.snapshot();
  assertEquals(snapshot.samples, 100);
  assertEquals(snapshot.p50Ms, 50);
  assertEquals(snapshot.p95Ms, 95);
  assertEquals(snapshot.maxMs, 100);
  assertAlmostEquals(snapshot.meanMs, 50.5);
});

Deno.test("the ring keeps only the last 300 frames", () => {
  const stats = createFrameStats({ observer: null });
  feed(stats, [90, ...Array.from({ length: RING_SIZE }, () => 16)]);
  const snapshot = stats.snapshot();
  assertEquals(snapshot.samples, RING_SIZE);
  assertEquals(snapshot.maxMs, 16);
  // The counters still remember the old spike.
  assertEquals(snapshot.spikes33, 1);
});

Deno.test("an empty ring reports zeros", () => {
  const snapshot = createFrameStats({ observer: null }).snapshot();
  assertEquals([snapshot.samples, snapshot.p95Ms, snapshot.maxMs], [0, 0, 0]);
});

Deno.test("spike counters split frames over 33 ms and over 100 ms", () => {
  const stats = createFrameStats({ observer: null });
  feed(stats, [16, 33, 34, 99, 100, 101, 400]);
  const snapshot = stats.snapshot();
  assertEquals(snapshot.spikes33, 5);
  assertEquals(snapshot.spikes100, 2);
});

Deno.test("a slow frame names its slowest phase in the spike log", () => {
  let time = 0;
  const stats = createFrameStats({ clock: () => time, observer: null });
  stats.frame(1000, info);
  stats.mark("step");
  time += 5;
  stats.mark("render");
  time += 140;
  stats.end();
  time += 3; // not in any phase
  stats.frame(1160, { viewMode: "master", zoom: 0.5, chunks: 40 });
  const [entry] = stats.snapshot().spikeLog;
  assertEquals(
    [entry.ms, entry.phase, entry.viewMode, entry.zoom, entry.chunks],
    [160, "render", "master", 0.5, 40],
  );
});

Deno.test("the spike log keeps the newest 20", () => {
  const stats = createFrameStats({ observer: null });
  feed(stats, Array.from({ length: 30 }, (_, index) => 101 + index));
  const log = stats.snapshot().spikeLog;
  assertEquals(log.length, SPIKE_LOG_SIZE);
  assertEquals(log[0].ms, 111);
  assertEquals(log[SPIKE_LOG_SIZE - 1].ms, 130);
});

Deno.test("a phase marked twice adds up, and averages smooth over frames", () => {
  let time = 0;
  const stats = createFrameStats({ clock: () => time, observer: null });
  stats.frame(0, info);
  for (let frame = 1; frame <= 2; frame++) {
    stats.mark("render");
    time += 10;
    stats.mark("step");
    time += 2;
    stats.mark("render");
    time += 10;
    stats.end();
    stats.frame(frame * 16, info);
  }
  assertEquals(stats.snapshot().phaseMs, { render: 20, step: 2 });
});

Deno.test("spike reports go out for frames over 250 ms, once a minute", () => {
  const stats = createFrameStats({ observer: null });
  const reports: number[] = [];
  stats.onSpike = (report) => reports.push(report.entry.ms);
  let now = 1000;
  const frame = (length: number) => stats.frame(now += length, info);
  frame(0);
  frame(200); // a bad spike, but under the report threshold
  frame(251); // reported
  frame(900); // inside the minute
  frame(30_000); // 31 s after the report: still limited
  assertEquals(reports, [251]);
  frame(30_000); // 61 s after it
  assertEquals(reports, [251, 30_000]);
});

Deno.test("the gap of a hidden tab is skipped", () => {
  const stats = createFrameStats({ observer: null });
  stats.frame(1000, info);
  stats.skipGap();
  stats.frame(60_000, info);
  assertEquals(stats.snapshot().spikes100, 0);
  assertEquals(stats.snapshot().samples, 0);
});

Deno.test("long tasks are counted and the longest kept", () => {
  let report: (durationMs: number) => void = () => {};
  const stats = createFrameStats({ observer: (onTask) => report = onTask });
  report(80);
  report(210);
  report(60);
  const snapshot = stats.snapshot();
  assertEquals([snapshot.longTasks, snapshot.longestTaskMs], [3, 210]);
});

Deno.test("the metrics fit the shell's names and leave out an unknown quad count", () => {
  const stats = createFrameStats({ observer: null });
  feed(stats, [16, 40, 120]);
  const names = Object.keys(summaryMetrics(stats.snapshot(), info));
  assertEquals(names, [
    "frameP95Ms",
    "spikes33",
    "spikes100",
    "longTasks",
    "longestTaskMs",
    "renderMs",
    "zoom",
    "master",
  ]);
  const withQuads = summaryMetrics(stats.snapshot(), { ...info, quads: 19000 });
  assertEquals(withQuads.quads, 19000);
  const spike = spikeMetrics({
    entry: { at: 0, ms: 300, phase: "render", ...info },
    phases: { render: 280, step: 4 },
    info,
  });
  assertEquals(spike.renderMs, 280);
  assertEquals(spike.frameMs, 300);
  for (const name of [...names, ...Object.keys(spike)]) {
    assertEquals(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(name), true, name);
  }
});

Deno.test("the F3 frame line shows a dash until the renderer reports", () => {
  const stats = createFrameStats({ observer: null });
  assertEquals(frameLine(stats.snapshot(), undefined), "FPS …");
  feed(stats, Array.from({ length: 20 }, () => 20));
  assertEquals(
    frameLine(stats.snapshot(), undefined),
    "FPS 50  p95 20  max 20  spikes 0/0  render -  quads -",
  );
  assertEquals(frameLine(stats.snapshot(), 19400).endsWith("quads 19k"), true);
});
