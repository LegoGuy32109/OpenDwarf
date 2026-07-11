import { expect, test } from "@playwright/test";

import {
  engineKeyDown,
  engineKeyUp,
  enginePress,
  engineSnapshot,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";

test("engine harness held-key focus repeat smoke", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");
  await stepEngineFrame(page, 1);

  await enginePress(page, "Escape");
  await stepEngineFrame(page, 2);

  await engineKeyDown(page, "KeyK");
  await stepEngineFrame(page, 1);
  const afterDown = await engineSnapshot(page);

  // Synthetic clock is +16ms/step; repeat delay is 400ms → need ≥25 frames
  // after the keydown frame for the first auto-repeat FocusNext.
  await stepEngineFrame(page, 30);
  const afterHold = await engineSnapshot(page);
  await engineKeyUp(page, "KeyK");

  expect(afterHold.frame.drawHash).not.toEqual(afterDown.frame.drawHash);
  expect(afterHold.shell.open).toBe(true);
  expect(afterDown.shell.open).toBe(true);
});
