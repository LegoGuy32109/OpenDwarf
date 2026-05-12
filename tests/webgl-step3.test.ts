import { expect, test } from "@playwright/test";
import {
  captureCheckpoint,
  loadFlow,
  setCamera,
  setViewMode,
  startCanvasRecording,
  stepTick,
  stopAndSaveCanvasRecording,
  waitForEvent,
  waitForHarness,
} from "./helpers/harness.ts";
import { flow } from "./flows/webgl-step1-single-rock.ts";

// IJKL key layout:
//   I → north (dy-)   K → south (dy+)
//   J → west  (dx-)   L → east  (dx+)
const OCTANTS: Array<{ name: string; keys: string[] }> = [
  { name: "north", keys: ["KeyI"] },
  { name: "northeast", keys: ["KeyI", "KeyL"] },
  { name: "east", keys: ["KeyL"] },
  { name: "southeast", keys: ["KeyK", "KeyL"] },
  { name: "south", keys: ["KeyK"] },
  { name: "southwest", keys: ["KeyK", "KeyJ"] },
  { name: "west", keys: ["KeyJ"] },
  { name: "northwest", keys: ["KeyI", "KeyJ"] },
];

const HOLD_MS = 2_000;

test("webgl step3 visual — keypresses in all 8 octants", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);
  await setViewMode(page, "master");
  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  // Record directly from the WebGL canvas — no JPEG screencasting in the path.
  await startCanvasRecording(page);

  const cpOrigin = await captureCheckpoint(page, "origin");
  const originChunks = new Set(cpOrigin?.visibleChunks ?? []);
  const originCamera = cpOrigin?.camera ?? { x: 0, y: 0, zoom: 1 };

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
    expect.soft(cpEnd?.camera, `${name}: camera moved`).not.toEqual(
      originCamera,
    );
    expect.soft(cpEnd?.player, `${name}: player stable`).toEqual(
      cpOrigin?.player,
    );

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
