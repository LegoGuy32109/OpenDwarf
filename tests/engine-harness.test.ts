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

  await engineTypeText(page, "hello world");
  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(true);
  expect(snapshot.session.chatDraft).toBe("hello world");
  expect(snapshot.session.chatCaret).toBe(11);

  await enginePress(page, "Enter");
  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(false);
  expect(snapshot.session.chatMessages).toContain("hello world");
  expect(snapshot.session.chatDraft).toBe("");

  await enginePress(page, "KeyT");
  await stepEngineFrame(page, 1);
  await engineTypeText(page, "blur");
  await stepEngineFrame(page, 1);
  await page.evaluate(() =>
    (document.querySelector("#od-text-capture") as HTMLInputElement | null)?.blur()
  );

  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(true);
  expect(snapshot.input.hiddenInputFocused).toBe(false);
  expect(snapshot.session.chatDraft).toBe("blur");

  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(true);
  expect(snapshot.input.hiddenInputFocused).toBe(true);

  await page.focus("#engine-canvas");
  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.input.textCaptureActive).toBe(true);
  expect(snapshot.input.hiddenInputFocused).toBe(true);

  await enginePaste(page, " world");
  await stepEngineFrame(page, 1);

  snapshot = await engineSnapshot(page);
  expect(snapshot.session.chatDraft).toBe("blur world");

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
