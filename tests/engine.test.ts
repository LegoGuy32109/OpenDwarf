import { expect, test } from "@playwright/test";

import {
  engineResetWorld,
  engineSnapshot,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";

test("engine route boots the Rust demo frame", async ({ page }) => {
  await page.goto("/engine");

  const canvas = page.locator("#engine-canvas");
  const errorOverlay = page.locator("#engine-error");

  await expect(canvas).toBeVisible();
  await expect(errorOverlay).toBeHidden();
  await page.waitForTimeout(1_000);
  await expect(canvas).toBeVisible();
});

test("engine harness exposes Rust world draw output", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");
  await stepEngineFrame(page, 1);

  let snapshot = await engineSnapshot(page);
  expect(snapshot.worldRender.floorQuadCount).toBeGreaterThan(0);
  expect(snapshot.worldRender.playerQuadCount).toBe(1);
  expect(snapshot.worldRender.atlasQuadCount).toBeGreaterThanOrEqual(
    snapshot.worldRender.floorQuadCount + snapshot.worldRender.playerQuadCount,
  );
  expect(snapshot.worldRender.visibleTileCount).toBeGreaterThan(0);
  expect(snapshot.frame.drawCount).toBeGreaterThan(2);

  await engineResetWorld(page, "play");
  await stepEngineFrame(page, 1);
  snapshot = await engineSnapshot(page);
  expect(snapshot.worldRender.floorQuadCount).toBeGreaterThan(0);
  expect(snapshot.worldRender.playerQuadCount).toBe(1);
});
