import { expect, test } from "@playwright/test";

import {
  engineResetWorld,
  engineSnapshot,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";

const enabled = process.env.ENGINE_PERF_TEST === "1";

function percentile(samples: number[], fraction: number) {
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[
    Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))
  ]!;
}

test("engine play-world frame baseline remains semantically healthy", async ({ page }) => {
  test.skip(
    !enabled,
    "set ENGINE_PERF_TEST=1 to run the isolated performance gate",
  );
  test.setTimeout(90_000);

  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await engineResetWorld(page, "play");
  await stepEngineFrame(page, 5);

  const samples: number[] = [];
  for (let index = 0; index < 5; index++) {
    const start = performance.now();
    await stepEngineFrame(page, 20);
    samples.push(performance.now() - start);
  }

  const snapshot = await engineSnapshot(page);
  const median = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  console.log(
    `engine perf baseline: median=${median.toFixed(1)}ms p95=${
      p95.toFixed(1)
    }ms samples=${samples.map((sample) => sample.toFixed(1)).join(",")}`,
  );

  expect(median).toBeLessThan(6_000);
  expect(snapshot.worldRender.floorQuadCount).toBeGreaterThan(0);
  expect(snapshot.worldRender.playerQuadCount).toBe(1);
  expect(snapshot.frame.droppedRects).toBe(0);
  expect(snapshot.frame.droppedGlyphs).toBe(0);
  expect(snapshot.frame.droppedDrawCmds).toBe(0);
  expect(snapshot.worldRender.droppedAtlasQuads).toBe(0);
  expect(snapshot.worldRender.droppedSolidQuads).toBe(0);
  expect(snapshot.worldRender.droppedDrawCmds).toBe(0);
  expect(snapshot.worldRender.snapshotCallsLastFrame).toBeGreaterThan(0);
});
