import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { facePlayer, openWorld, placePlayer, readWorld } from "./world.ts";
import { ready } from "./ui.ts";
import { waitFor } from "./time.ts";
import { evidenceShot } from "./evidence.ts";
const material = (page: Page, x: number, y: number) =>
  readWorld(
    page,
    (w, { x, y }) => w.materials.readTile(w.scene.world, x, y, 1),
    { x, y },
  );
test("host and guest retain mined ore and a released placement across host chunk unload and replay", async ({ page: host, context }) => {
  await openWorld(host, "/?harness=1&unloadGraceMs=50");
  await ready(host);
  const session = await readWorld(host, (w) => w.scene.sessionId);
  const guest = await context.newPage();
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() => readWorld(guest, (w) => w.scene.localId)).toMatch(
    /^peer-/,
  );
  const id = await readWorld(guest, (w) => w.scene.localId);
  await placePlayer(host, 80, 80);
  await expect.poll(() =>
    readWorld(host, (w) => w.scene.world.chunks.has("5,5"))
  ).toBe(true);
  await readWorld(host, (w, id) =>
    w.edit({
      tiles: [{
        bounds: { minX: 78, maxX: 83, minY: 77, maxY: 83, minZ: 1, maxZ: 1 },
        material: 1,
      }, {
        bounds: { minX: 80, maxX: 80, minY: 79, maxY: 79, minZ: 1, maxZ: 1 },
        material: 3,
      }],
      players: [{
        id,
        at: { x: 81, y: 80, z: 1 },
        facing: { x: 0, y: 1 },
        inventory: [{ kind: "stone", count: 2 }],
        held: "stone",
      }],
    }), id);
  await facePlayer(host, 0, -1);
  await expect.poll(() => material(guest, 80, 79)).toBe(3);
  await host.keyboard.down("Space");
  await waitFor(host, async () => await material(host, 80, 79) === 1);
  await host.keyboard.up("Space");
  await expect.poll(() => material(guest, 80, 79)).toBe(1);
  await expect.poll(() => readWorld(guest, (w) => w.scene.heldFeed)).toBe(
    "stone",
  );
  await guest.keyboard.press("Space");
  await expect.poll(() => material(host, 81, 81)).toBe(2);
  await expect.poll(() => material(guest, 81, 81)).toBe(2);
  await placePlayer(host, 240, 240);
  await placePlayer(host, 241, 240, 1, id);
  await expect.poll(() =>
    readWorld(guest, (w) => w.scene.world.players[w.scene.localId].x)
  ).toBe(241);
  await expect.poll(() =>
    readWorld(host, (w) => w.scene.world.chunks.has("5,5"))
  ).toBe(false);
  await expect.poll(() =>
    readWorld(host, (w) => w.scene.world.chunks.has("5,4"))
  ).toBe(false);
  await placePlayer(host, 80, 80);
  await placePlayer(host, 81, 80, 1, id);
  await expect.poll(() =>
    readWorld(host, (w) => w.scene.world.chunks.has("5,5"))
  ).toBe(true);
  await expect.poll(() =>
    readWorld(guest, (w) => w.scene.world.players[w.scene.localId].x)
  ).toBe(81);
  await expect.poll(() =>
    readWorld(guest, (w) => w.scene.visibility.visible.has("80,79,1"))
  ).toBe(true);
  for (const page of [host, guest]) {
    await expect.poll(() => material(page, 80, 79)).toBe(1);
    await expect.poll(() => material(page, 81, 81)).toBe(2);
    expect(
      await readWorld(page, (w) => w.scene.world.players[w.scene.localId].z),
    ).toBe(1);
  }
  expect(await readWorld(guest, (w) => w.cursor()?.held)).toBe("stone");
  expect(await readWorld(guest, (w) => w.cursor()?.iconFrame)).toBe(0);
  await evidenceShot(guest, "134-guest-replayed-edits");
});

test("keyboard stone aiming releases a four-tile throw and leaves the facing tile open", async ({ page }) => {
  await openWorld(page, "/?harness=1");
  await ready(page);
  await placePlayer(page, 6, 6);
  await readWorld(
    page,
    (w) =>
      w.edit({
        players: [{
          id: w.scene.localId,
          inventory: [{ kind: "stone", count: 3 }],
          held: "stone",
        }],
      }),
  );
  await page.keyboard.down("Space");
  await page.keyboard.down("i");
  await expect.poll(() => readWorld(page, (w) => w.scene.actionGesture?.aiming))
    .toBe(true);
  await page.keyboard.up("Space");
  await page.keyboard.up("i");
  await waitFor(
    page,
    () =>
      readWorld(
        page,
        (w) =>
          w.scene.items.some((e) =>
            e.x === 6 && e.y === 2 && e.z === 1 &&
            e.stacks.some((s) => s.kind === "stone" && s.count === 1)
          ),
      ),
  );
  expect(
    await readWorld(
      page,
      (w) => w.scene.inventory.find((s) => s.kind === "stone")?.count,
    ),
  ).toBe(2);
  expect(await material(page, 6, 5)).toBe(1);
  await evidenceShot(page, "134-keyboard-stone-landing");
});
