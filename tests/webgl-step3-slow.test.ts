import { expect, test } from "@playwright/test";
import {
  captureCheckpoint,
  loadFlow,
  setCamera,
  setCameraSpeed,
  setViewMode,
  startCanvasRecording,
  stepTick,
  stopAndSaveCanvasRecording,
  waitForEvent,
  waitForHarness,
} from "./helpers/harness.ts";
import { flow } from "./flows/webgl-step1-single-rock.ts";

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

// 120px/s = quarter of the default 480px/s.
// N/S chunk boundary sits 484px away → needs 4.03s to cross. 4100ms is the margin.
const SLOW_SPEED = 120;
const HOLD_MS = 4_100;

test("webgl step3 slow visual — keypresses in all 8 octants", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);
  await setViewMode(page, "master");
  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  await setCameraSpeed(page, SLOW_SPEED);
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
    "exports/canvas-recordings/step3-octants-slow.webm",
  );
});
