import { expect, test } from "@playwright/test";
import {
  captureCheckpoint,
  loadFlow,
  setCamera,
  stepTick,
  waitForEvent,
  waitForHarness,
} from "./helpers/harness.ts";
import { flow } from "./flows/webgl-step1-single-rock.ts";

test("webgl step2 — resident chunks populated after texture load", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);

  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  const cp = await captureCheckpoint(page, "chunks_loaded");
  expect.soft(cp, "checkpoint present").not.toBeNull();
  expect.soft(cp?.residentChunks, "resident chunks > 0").toBeGreaterThan(0);
  expect.soft(cp?.visibleChunks.length, "visible chunks > 0").toBeGreaterThan(
    0,
  );
  expect.soft(cp?.stateHash, "state hash present").toMatch(/^sha256:/);
});

test("webgl step2 — visible chunks change as camera pans", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);

  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  const cpA = await captureCheckpoint(page, "pan_start");
  expect.soft(cpA, "start checkpoint present").not.toBeNull();

  await setCamera(page, 960, 0, 1);
  await stepTick(page, 4);

  const cpB = await captureCheckpoint(page, "pan_end");
  expect.soft(cpB, "end checkpoint present").not.toBeNull();

  if (cpA && cpB) {
    const setA = new Set(cpA.visibleChunks);
    const setB = new Set(cpB.visibleChunks);
    const same = [...setA].every((k) => setB.has(k)) &&
      setA.size === setB.size;
    expect.soft(same, "visible chunks differ after pan").toBe(false);
    // After panning to x=960, chunk column x=-1 drops out and x=1 enters
    expect.soft(
      cpB.visibleChunks.some((k) => k.startsWith("1,")),
      "chunk x=1 visible at x=960",
    ).toBe(true);
  }
});
