import { expect, test } from "@playwright/test";

import {
  engineBlur,
  engineFocus,
  enginePaste,
  enginePress,
  engineSnapshot,
  engineTypeText,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";

test("engine harness paste + blur/resync smoke", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");
  await stepEngineFrame(page, 1);

  await enginePress(page, "KeyT");
  await stepEngineFrame(page, 1);

  let snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(true);
  expect(snapshot.session.uiMode).toBe("chat");

  await engineTypeText(page, "blur");
  await stepEngineFrame(page, 1);
  await engineBlur(page);

  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(true);
  expect(snapshot.input.hiddenInputFocused).toBe(false);
  expect(snapshot.session.chatDraft).toBe("blur");

  await stepEngineFrame(page, 1);
  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(true);
  expect(snapshot.input.hiddenInputFocused).toBe(true);

  await engineFocus(page);
  await stepEngineFrame(page, 1);

  await enginePaste(page, " world");
  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.session.chatDraft).toBe("blur world");
});
