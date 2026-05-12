import { expect, test } from "npm:@playwright/test@1.52.0";
import {
  captureCheckpoint,
  loadFlow,
  setCamera,
  stepTick,
  waitForEvent,
  waitForHarness,
} from "./helpers/harness.ts";
import { flow } from "./flows/webgl-step1-single-rock.ts";

test("webgl step1 single rock — boot and texture load", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);

  await waitForEvent(page, "texture_loaded");

  const cp = await captureCheckpoint(page, "texture_loaded");
  expect.soft(cp, "texture_loaded checkpoint").not.toBeNull();
  expect.soft(cp?.perf.frames, "frames measured").toBeGreaterThan(0);
  expect.soft(cp?.perf.cpuMs.p95, "p95 cpu < 16ms").toBeLessThan(16);
  expect.soft(cp?.perf.drawCalls.p50, "draw call recorded")
    .toBeGreaterThanOrEqual(1);
  expect.soft(cp?.stateHash, "state hash present").toMatch(/^sha256:/);
});

const CAMERA_STEPS = [
  { x: 0, y: 0 },
  { x: 192, y: 0 },
  { x: 384, y: 0 },
  { x: 576, y: 0 },
  { x: 768, y: 0 },
  { x: 960, y: 0 },
];

test("webgl step1 single rock — camera pan", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);

  await waitForEvent(page, "texture_loaded");

  for (const [i, step] of CAMERA_STEPS.entries()) {
    await setCamera(page, step.x, step.y, 1);
    await stepTick(page, 4);

    const cp = await captureCheckpoint(page, `camera_pan_${i}`);
    expect.soft(cp, `pan ${i} checkpoint`).not.toBeNull();
    expect.soft(cp?.perf.frames, `pan ${i} frames`).toBeGreaterThan(0);
    expect.soft(
      cp?.perf.drawCalls.p50,
      `pan ${i} draw calls`,
    ).toBeGreaterThanOrEqual(1);
  }
});
