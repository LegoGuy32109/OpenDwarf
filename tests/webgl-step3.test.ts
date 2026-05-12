import { expect, test } from "@playwright/test";
import {
  captureCheckpoint,
  loadFlow,
  setCamera,
  startCanvasRecording,
  stepTick,
  stopAndSaveCanvasRecording,
  waitForEvent,
  waitForHarness,
} from "./helpers/harness.ts";
import { flow } from "./flows/webgl-step1-single-rock.ts";

// ESDF / IJKL key layout:
//   E / I → north (dy-)   D / K → south (dy+)
//   S / J → west  (dx-)   F / L → east  (dx+)
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

const HOLD_MS = 2_000;

test("webgl step3 visual — keypresses in all 8 octants", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);
  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  // Record directly from the WebGL canvas — no JPEG screencasting in the path.
  await startCanvasRecording(page);

  const cpOrigin = await captureCheckpoint(page, "origin");
  const originChunks = new Set(cpOrigin?.visibleChunks ?? []);

  for (const { name, keys } of OCTANTS) {
    await setCamera(page, 0, 0, 1);

    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(HOLD_MS);
    for (const key of keys) await page.keyboard.up(key);

    const cpEnd = await captureCheckpoint(page, name);

    expect.soft(cpEnd, `${name}: end checkpoint present`).not.toBeNull();
    expect.soft(
      cpEnd?.residentChunks,
      `${name}: streaming window leads camera`,
    ).toBeGreaterThan(cpEnd?.visibleChunks.length ?? 0);

    if (cpEnd) {
      const after = new Set(cpEnd.visibleChunks);
      const same = [...originChunks].every((k) => after.has(k)) &&
        originChunks.size === after.size;
      expect.soft(!same, `${name}: visible chunks changed after pan`).toBe(
        true,
      );
    }
  }

  await stopAndSaveCanvasRecording(
    page,
    "exports/canvas-recordings/step3-octants.webm",
  );
});
