import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type Cursor = {
  tile: { x: number; y: number; z: number };
  held: string;
  preview: string | null;
  color: string;
  opacity: number;
  iconFrame: number | null;
  iconOpacity: number;
} | null;
type Harness = {
  __od: {
    cursor: () => Cursor;
    scene: {
      localId: string;
      world: { players: Record<string, Record<string, unknown>> };
    };
  };
};

const cursor = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.cursor());

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

/** Give the host's own player a stack and hold it, as the bag does. */
const hold = (page: Page, kind: string) =>
  page.evaluate(async (k) => {
    const items = await import("/src/shared/items.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[scene.localId];
    items.addStack(items.inventoryOf(player as never), k, 1);
    player.held = k;
  }, kind);

test("the cursor draws the held item's icon and follows a change of held item", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?harness=1");
  await ready(page);
  // Row y 1 holds stone at x 2; row y 2 is open floor.
  await placeAt(page, 2, 2);
  await page.keyboard.down("i"); // aim north at the stone
  await page.waitForTimeout(200);
  const pickaxe = await cursor(page);
  expect(pickaxe?.held).toBe("pickaxe");
  expect(pickaxe?.tile).toEqual({ x: 2, y: 1, z: 0 });
  expect(pickaxe?.color).toBe("#ffb833");
  expect(pickaxe?.opacity).toBe(0.6);
  expect(pickaxe?.iconFrame).not.toBeNull();
  await evidenceShot(page, "cursor-rock-pickaxe");
  await page.keyboard.up("i");

  await hold(page, "stone");
  await page.keyboard.down("k"); // aim south at open floor
  await page.waitForTimeout(200);
  const stone = await cursor(page);
  expect(stone?.held).toBe("stone");
  expect(stone?.tile).toEqual({ x: 2, y: 3, z: 0 });
  expect(stone?.iconFrame).toBe(0); // the stone frame
  expect(stone?.iconFrame).not.toBe(pickaxe?.iconFrame);
  // Until the reach rules fill `interactPreview`, the icon is dimmed.
  expect(stone?.iconOpacity).toBe(stone?.preview === null ? 0.35 : 1);
  await evidenceShot(page, "cursor-open-stone");
  await page.keyboard.up("k");
});
