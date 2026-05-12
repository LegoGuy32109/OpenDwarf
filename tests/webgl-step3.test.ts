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

// ESDF / IJKL key layout:
//   E / I → camera north (dy-)
//   D / K → camera south (dy+)
//   S / J → camera west  (dx-)
//   F / L → camera east  (dx+)
const OCTANTS: Array<{ name: string; keys: string[] }> = [
  { name: "north", keys: ["KeyE"] },
  { name: "northeast", keys: ["KeyE", "KeyF"] },
  { name: "east", keys: ["KeyF"] },
  { name: "southeast", keys: ["KeyD", "KeyF"] },
  { name: "south", keys: ["KeyD"] },
  { name: "southwest", keys: ["KeyD", "KeyS"] },
  { name: "west", keys: ["KeyS"] },
  { name: "northwest", keys: ["KeyE", "KeyS"] },
];

// Frames held per octant. At ~100ms/frame (SwiftShader) and 480px/s, each
// frame moves ~48px. 10 frames ≈ 480px — enough to shift past the nearest
// chunk boundary (320px from origin with a 640-wide viewport).
const HOLD_FRAMES = 10;

test("webgl step3 — streaming window covers visible chunks plus padding", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);

  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  const cp = await captureCheckpoint(page, "stream_at_origin");
  expect.soft(cp, "checkpoint present").not.toBeNull();
  if (cp) {
    expect.soft(cp.residentChunks, "resident >= visible")
      .toBeGreaterThanOrEqual(cp.visibleChunks.length);
    expect.soft(
      cp.residentChunks,
      "resident chunks > visible (padding loaded)",
    ).toBeGreaterThan(cp.visibleChunks.length);
  }
});

test("webgl step3 — keypresses in all 8 octants move camera and update chunks", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);

  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  const cpOrigin = await captureCheckpoint(page, "origin");
  const originChunks = new Set(cpOrigin?.visibleChunks ?? []);

  for (const { name, keys } of OCTANTS) {
    // Reset camera to origin before each direction.
    await setCamera(page, 0, 0, 1);
    await stepTick(page, 1);

    // Hold keys and let frames render so the video shows real camera movement.
    for (const key of keys) await page.keyboard.down(key);
    await stepTick(page, HOLD_FRAMES);
    for (const key of keys) await page.keyboard.up(key);

    const cpEnd = await captureCheckpoint(page, name);

    expect.soft(cpEnd, `${name}: end checkpoint present`).not.toBeNull();
    expect.soft(
      cpEnd?.residentChunks,
      `${name}: streaming window leads camera (resident > visible)`,
    ).toBeGreaterThan(cpEnd?.visibleChunks.length ?? 0);

    if (cpEnd) {
      const after = new Set(cpEnd.visibleChunks);
      const same = [...originChunks].every((k) => after.has(k)) &&
        originChunks.size === after.size;
      expect.soft(!same, `${name}: visible chunks changed after keypress pan`).toBe(true);
    }
  }
});
