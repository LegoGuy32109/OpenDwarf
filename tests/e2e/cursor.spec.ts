import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";
const cursor = (page: Page) => readWorld(page, (__world) => __world.cursor());
const placeAt = (page: Page, x: number, y: number) =>
  readWorld(page, (__world, [px, py]) => {
    const scene = __world.scene;
    __world.edit({
      players: [{
        id: scene.world.players[scene.localId].id,
        at: {
          x: px,
          y: py,
          z: scene.world.players[scene.localId].z,
        },
      }],
    });
  }, [x, y]);
test("the cursor draws the held item's icon and follows a change of held item", async ({ page }) => {
  await openWorld(page, "/?harness=1");
  await ready(page);
  // Row y 1 holds stone at x 2; row y 2 is open floor.
  await placeAt(page, 2, 2);
  await page.keyboard.down("i"); // aim north at the stone
  await expect.poll(async () => (await cursor(page))?.tile).toEqual({
    x: 2,
    y: 1,
    z: 0,
  });
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
  await expect.poll(async () => {
    const c = await cursor(page);
    return c && { held: c.held, tile: c.tile };
  }).toEqual({ held: "stone", tile: { x: 2, y: 3, z: 0 } });
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
const hold = (page: Page, kind: string) =>
  readWorld(page, (world, kind) =>
    world.edit({
      players: [{
        id: world.scene.localId,
        inventory: [{ kind, count: 1 }],
        held: kind,
      }],
    }), kind);
