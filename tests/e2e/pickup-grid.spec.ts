import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { holdTicks } from "./time.ts";
import { ready, tapUi } from "./ui.ts";

type Stack = { kind: string; count: number };
type Cell = {
  index: number;
  x: number;
  y: number;
  size: number;
  selected: boolean;
  more: boolean;
  alpha: number;
};
type Harness = {
  __od: {
    scene: {
      menu: boolean;
      zoom: number;
      camera: { x: number; y: number };
      pickupCells: Cell[];
      inventory: Stack[];
      items: { x: number; y: number; stacks: Stack[] }[];
      hearingLog: { lines: { kind: string; text: string }[] };
      world: { players: Record<string, Record<string, number>> };
      localId: string;
    };
  };
};

const KINDS = [
  "stone",
  "coal",
  "iron ore",
  "gold ore",
  "lapis",
  "redstone",
  "diamond",
  "emerald",
  "coin",
  "pickaxe",
];

const cells = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.pickupCells
  );
const selected = async (page: Page) =>
  (await cells(page)).find((cell) => cell.selected)?.index ?? -1;
/** Every square has finished unfolding (the unfold eases on the page clock). */
const unfolded = async (page: Page) => {
  const all = await cells(page);
  return all.length > 0 && all.every((cell) => cell.alpha === 1);
};
const inventory = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.inventory);
const menuOpen = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.menu);
const systemLines = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.hearingLog.lines
      .filter((line) => line.kind === "system").map((line) => line.text)
  );

/** Stand the host's player still at a position. */
const placeAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    Object.assign(scene.world.players[scene.localId], {
      x: px,
      y: py,
      previousX: px,
      previousY: py,
    });
  }, [x, y]);

const position = (page: Page) =>
  page.evaluate(() => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    return scene.world.players[scene.localId];
  });

/** Drop one stack on a tile at level 0, as a finished mining action does. */
const drop = (page: Page, x: number, y: number, kind: string, count = 1) =>
  page.evaluate(async ([px, py, k, n]) => {
    const items = await import("/src/shared/items.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    items.dropItem(
      scene.world as never,
      { x: px as number, y: py as number, z: 0 },
      k as string,
      n as number,
    );
  }, [x, y, kind, count]);

async function startHost(page: Page, query = "") {
  await page.goto(`/?harness=1${query}`);
  await ready(page);
}

/** A tile south of the player holds the given kinds. */
async function setUp(page: Page, kinds: string[]) {
  await placeAt(page, 4, 2);
  for (const [i, kind] of kinds.entries()) await drop(page, 4, 3, kind, i + 1);
}

test("keyboard: interact opens the grid, IJKL selects, interact picks up, Escape closes", async ({ page }) => {
  await startHost(page);
  await page.keyboard.press("Backquote"); // show the hearing log in the video
  await setUp(page, KINDS.slice(0, 4));
  await page.keyboard.down("k"); // aim south at the tile
  await page.keyboard.press("Space");
  await page.keyboard.up("k");
  await expect.poll(async () => (await cells(page)).length).toBe(4);
  await expect.poll(() => unfolded(page)).toBe(true);
  await expect.poll(() => selected(page)).toBe(0);
  await evidenceShot(page, "grid-four-stacks");
  await page.keyboard.press("l");
  await expect.poll(() => selected(page)).toBe(1);
  await page.keyboard.press("k");
  await expect.poll(() => selected(page)).toBe(3);
  await page.keyboard.press("j");
  await expect.poll(() => selected(page)).toBe(3);
  await evidenceShot(page, "grid-selected-coal");
  // The look control drives the grid, so the player stays where it stood.
  expect((await position(page))!.y).toBeCloseTo(2, 1);
  await page.keyboard.press("i");
  await page.keyboard.press("l");
  await expect.poll(() => selected(page)).toBe(1);
  await page.keyboard.press("Space"); // picks up coal ×2
  await expect.poll(() => inventory(page)).toEqual([
    { kind: "pickaxe", count: 1 },
    { kind: "coal", count: 2 },
  ]);
  await expect.poll(async () => (await cells(page)).length).toBe(3);
  expect(await systemLines(page)).toContain("Picked up coal ×2");
  await evidenceShot(page, "grid-after-pickup");
  // Escape closes the grid first and does not open the menu.
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await cells(page)).length).toBe(0);
  expect(await menuOpen(page)).toBe(false);
  // Open it again, then walk out of reach: it closes.
  await page.keyboard.down("k");
  await page.keyboard.press("Space");
  await page.keyboard.up("k");
  await expect.poll(async () => (await cells(page)).length).toBe(3);
  await holdTicks(page, "s", 2); // west is cheap to hold, but reach is by tile
  await placeAt(page, 4, 5);
  await expect.poll(async () => (await cells(page)).length).toBe(0);
});

test("a single stack is picked up at once, with no grid", async ({ page }) => {
  await startHost(page);
  await setUp(page, ["diamond"]);
  await page.keyboard.down("k");
  await page.keyboard.press("Space");
  await page.keyboard.up("k");
  await expect.poll(() => inventory(page)).toEqual([
    { kind: "pickaxe", count: 1 },
    { kind: "diamond", count: 1 },
  ]);
  expect(await cells(page)).toEqual([]);
});

test("gamepad: the D-pad moves the selector, ZR picks up", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
      connected: true,
      id: "Test Switch controller",
      index: 0,
      mapping: "standard",
    };
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad] });
    (globalThis as unknown as { __testPad: typeof pad }).__testPad = pad;
  });
  await startHost(page, "&gamepad-debug=1");
  await page.locator("#world").click();
  await setUp(page, KINDS.slice(0, 5));
  type Pad = { axes: number[]; buttons: { pressed: boolean }[] };
  /**
   * Hold a control for exactly one drawn frame, then let it go. A held D-pad or
   * stick repeats after a real-time delay, so a longer hold can count twice on
   * a slow machine.
   */
  const tap = async (down: (pad: Pad) => void, up: (pad: Pad) => void) => {
    await page.evaluate(
      ([downSource, upSource]) =>
        new Promise<void>((resolve) => {
          const pad = (globalThis as unknown as { __testPad: Pad }).__testPad;
          new Function("pad", `(${downSource})(pad)`)(pad);
          requestAnimationFrame(() => {
            new Function("pad", `(${upSource})(pad)`)(pad);
            requestAnimationFrame(() => resolve());
          });
        }),
      [down.toString(), up.toString()],
    );
  };
  // The look stick aims south, interact opens the grid.
  await page.evaluate(() => {
    (globalThis as unknown as { __testPad: Pad }).__testPad.axes[3] = 1;
  });
  await tap((pad) => {
    pad.buttons[7].pressed = true;
  }, (pad) => {
    pad.buttons[7].pressed = false;
    pad.axes[3] = 0;
  });
  await expect.poll(async () => (await cells(page)).length).toBe(5);
  await tap((pad) => {
    pad.buttons[15].pressed = true; // D-pad right
  }, (pad) => {
    pad.buttons[15].pressed = false;
  });
  await expect.poll(() => selected(page)).toBe(1);
  await tap((pad) => {
    pad.buttons[13].pressed = true; // D-pad down
  }, (pad) => {
    pad.buttons[13].pressed = false;
  });
  await expect.poll(() => selected(page)).toBe(4);
  // The D-pad did not walk the entity.
  expect((await position(page))!.y).toBeCloseTo(2, 1);
  await tap((pad) => {
    pad.axes[2] = -1; // look stick left
  }, (pad) => {
    pad.axes[2] = 0;
  });
  await expect.poll(() => selected(page)).toBe(3);
  await tap((pad) => {
    pad.buttons[7].pressed = true;
  }, (pad) => {
    pad.buttons[7].pressed = false;
  });
  await expect.poll(() => inventory(page)).toEqual([
    { kind: "pickaxe", count: 1 },
    { kind: "gold ore", count: 4 },
  ]);
});

test.describe("touch", () => {
  test.use({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });

  test("tapping a square selects it, the interact button picks it up", async ({ page }) => {
    await startHost(page);
    await placeAt(page, 4, 2);
    for (const [i, kind] of KINDS.slice(0, 6).entries()) {
      await drop(page, 4, 2, kind, i + 1);
    }
    // No aim: the player's own tile holds the stacks, so the interact button opens the grid.
    await tapUi(page, "btn:interact");
    await expect.poll(async () => (await cells(page)).length).toBe(6);
    await expect.poll(() => unfolded(page)).toBe(true);
    const target = (await cells(page)).find((cell) => cell.index === 4)!;
    const view = await page.evaluate(() => {
      const scene = (globalThis as unknown as Harness).__od.scene;
      return { zoom: scene.zoom, camera: scene.camera };
    });
    const canvas = (await page.locator("#world").boundingBox())!;
    await page.touchscreen.tap(
      canvas.x + canvas.width / 2 +
        (target.x + target.size / 2 - view.camera.x) * view.zoom,
      canvas.y + canvas.height / 2 +
        (target.y + target.size / 2 - view.camera.y) * view.zoom,
    );
    await expect.poll(() => selected(page)).toBe(4);
    await evidenceShot(page, "grid-touch-selected");
    await tapUi(page, "btn:interact");
    await expect.poll(() => inventory(page)).toEqual([
      { kind: "pickaxe", count: 1 },
      { kind: "lapis", count: 5 },
    ]);
    await expect.poll(async () => (await cells(page)).length).toBe(5);
  });
});
