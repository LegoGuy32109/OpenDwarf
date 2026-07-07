import { expect, test } from "@playwright/test";

import {
  enginePress,
  enginePaste,
  engineSnapshot,
  engineTypeText,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";

test("engine harness chat smoke", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);

  await stepEngineFrame(page, 1);

  await page.focus("#engine-canvas");
  await enginePress(page, "KeyT");
  await stepEngineFrame(page, 1);

  let snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(true);
  expect(snapshot.session.uiMode).toBe("chat");
  expect(snapshot.session.chatDraft).toBe("");

  await engineTypeText(page, "hello");
  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(true);
  expect(snapshot.session.chatDraft).toBe("hello");
  expect(snapshot.session.chatCaret).toBe(5);

  await page.keyboard.press("Enter");
  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(false);
  expect(snapshot.session.chatMessages).toContain("hello");
  expect(snapshot.session.chatDraft).toBe("");

  await enginePress(page, "KeyT");
  await stepEngineFrame(page, 1);
  await enginePaste(page, "cancel");
  await stepEngineFrame(page, 1);
  await enginePress(page, "Escape");
  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(false);
  expect(snapshot.shell.open).toBe(false);

  await enginePress(page, "Escape");
  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.shell.open).toBe(true);
});
