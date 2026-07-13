import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  engineResetWorld,
  engineSnapshot,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";
import {
  captureEngineWasmResponse,
  expectServedEngineWasm,
} from "./helpers/wasm-provenance.ts";

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

  const provenance = await expectServedEngineWasm(page);
  expect(provenance.metadata.profile).toBe("release");
  await waitForEngineHarness(page);
  // Let Vite finish its initial module graph/HMR bookkeeping after a fresh
  // release build, then make one explicit settled navigation before timing.
  await page.waitForTimeout(10_000);
  const finishMeasuredWasm = captureEngineWasmResponse(page);
  await page.reload({ waitUntil: "networkidle" });
  await waitForEngineHarness(page);
  const measuredWasm = await finishMeasuredWasm();
  expect(measuredWasm.sha256).toBe(provenance.metadata.wasm.sha256);
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
  console.log(
    `engine measured release wasm: metadata=${provenance.metadata.wasm.sha256} served=${measuredWasm.sha256}`,
  );
  console.log(
    `engine perf semantics: tick=${snapshot.world.tick} worldStateHash=${snapshot.world.worldStateHash} drawCount=${snapshot.frame.drawCount} observedDrawHash=${snapshot.frame.drawHash} floor=${snapshot.worldRender.floorQuadCount} player=${snapshot.worldRender.playerQuadCount} atlas=${snapshot.worldRender.atlasQuadCount}`,
  );

  expect(median).toBeLessThan(6_000);
  expect(snapshot.worldRender.floorQuadCount).toBe(130);
  expect(snapshot.worldRender.playerQuadCount).toBe(1);
  expect(snapshot.worldRender.atlasQuadCount).toBe(131);
  expect(snapshot.world.tick).toBe(33);
  expect(snapshot.world.worldStateHash).toBe("fnv1a64:11f96a454cacdf3d");
  expect(snapshot.frame.drawCount).toBe(7);
  expect(snapshot.frame.drawHash).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
  expect(snapshot.frame.droppedRects).toBe(0);
  expect(snapshot.frame.droppedGlyphs).toBe(0);
  expect(snapshot.frame.droppedDrawCmds).toBe(0);
  expect(snapshot.worldRender.droppedAtlasQuads).toBe(0);
  expect(snapshot.worldRender.droppedSolidQuads).toBe(0);
  expect(snapshot.worldRender.droppedDrawCmds).toBe(0);
  expect(snapshot.worldRender.snapshotCallsLastFrame).toBe(1);

  const reportPath = process.env.ENGINE_PERF_REPORT_PATH;
  if (reportPath) {
    const report = {
      schemaVersion: 1,
      stage: Number(process.env.ENGINE_REPORT_STAGE ?? "1"),
      artifact: {
        profile: provenance.metadata.profile,
        metadataSha256: provenance.metadata.wasm.sha256,
        servedSha256: measuredWasm.sha256,
      },
      samplesMs: samples,
      medianMs: median,
      p95Ms: p95,
      ceilingMs: 6_000,
      semantics: {
        floorQuadCount: snapshot.worldRender.floorQuadCount,
        playerQuadCount: snapshot.worldRender.playerQuadCount,
        atlasQuadCount: snapshot.worldRender.atlasQuadCount,
        worldTick: snapshot.world.tick,
        worldStateHash: snapshot.world.worldStateHash,
        drawCount: snapshot.frame.drawCount,
        observedDrawHash: snapshot.frame.drawHash,
        droppedRects: snapshot.frame.droppedRects,
        droppedGlyphs: snapshot.frame.droppedGlyphs,
        droppedFrameDrawCmds: snapshot.frame.droppedDrawCmds,
        droppedAtlasQuads: snapshot.worldRender.droppedAtlasQuads,
        droppedSolidQuads: snapshot.worldRender.droppedSolidQuads,
        droppedWorldDrawCmds: snapshot.worldRender.droppedDrawCmds,
        snapshotCallsLastFrame: snapshot.worldRender.snapshotCallsLastFrame,
      },
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
});
