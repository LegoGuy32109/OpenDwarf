import { evidenceShot } from "./evidence.ts";
import { expect, test } from "./fixtures.ts";
import { worldBuilder } from "../../src/shared/world-builder.js";
import { OPEN, STONE } from "../../src/shared/terrain.js";
import { configureWorld, openWorld, readWorld, startWorld } from "./world.ts";
import { ready } from "./ui.ts";
import { waitFor, waitTicks } from "./time.ts";

function definition() {
  return worldBuilder().bounds({
    minX: 0,
    maxX: 8,
    minY: 0,
    maxY: 8,
    minZ: 0,
    maxZ: 2,
  })
    .fill({ minX: 1, maxX: 7, minY: 1, maxY: 7, minZ: 1, maxZ: 1 }, OPEN)
    .spawn({ x: 4, y: 4, z: 1 }).spawn({ x: 6, y: 4, z: 1 })
    .entity({
      id: "counter",
      name: "Ulgar",
      role: "trader",
      at: { x: 5, y: 4, z: 1 },
      behavior: { id: "still" },
    })
    .definition();
}

test("a serialized small world boots with only its authored NPC and no generation and replays on reload", async ({ page }) => {
  const setup = definition();
  await startWorld(page, setup);
  await ready(page);
  const state = () =>
    readWorld(
      page,
      (w) => ({
        ids: Object.keys(w.scene.world.players),
        counter: w.scene.world.players.counter,
        limits: w.scene.world.limits,
        position: w.scene.world.players.self,
        chunks: w.scene.world.chunks.size,
      }),
    );
  await expect.poll(async () => (await state()).ids).toEqual([
    "counter",
    "self",
  ]);
  expect((await state()).counter).toMatchObject({
    name: "Ulgar",
    npc: true,
    role: "trader",
    x: 5,
    y: 4,
    z: 1,
  });
  expect((await state()).limits).toEqual(setup.bounds);
  expect((await state()).position).toMatchObject({ x: 4, y: 4, z: 1 });
  await waitTicks(page, 5);
  expect((await state()).chunks).toBe(1);
  await evidenceShot(page, "world-builder-small");
  await page.reload();
  await ready(page);
  expect((await state()).position).toMatchObject({ x: 4, y: 4, z: 1 });
});

test("a custom trader NPC reaches a guest and opens through real keyboard input", async ({ page, context }) => {
  const host = page, guest = await context.newPage();
  await startWorld(host, definition());
  await ready(host);
  const session = await readWorld(host, (w) => w.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() => readWorld(guest, (w) => w.scene.localId)).toMatch(
    /^peer-/,
  );
  await expect.poll(() =>
    readWorld(guest, (w) => w.scene.world.players.counter)
  ).toMatchObject({ name: "Ulgar", role: "trader", x: 5, y: 4, z: 1 });
  expect(await readWorld(guest, (w) => w.scene.world.limits)).toEqual(
    definition().bounds,
  );
  await guest.keyboard.down("j");
  await guest.keyboard.press("Space");
  await guest.keyboard.up("j");
  await expect.poll(() =>
    readWorld(guest, (w) => w.ui.ids().includes("panel:shop"))
  ).toBe(true);
  await evidenceShot(guest, "world-builder-custom-shop");
  await host.close();
  await guest.close();
});

test("a declared mining fixture completes through the browser simulation runner", async ({ page }) => {
  const setup = worldBuilder().fill({
    minX: 1,
    maxX: 7,
    minY: 1,
    maxY: 7,
    minZ: 1,
    maxZ: 1,
  }, OPEN).tile({ x: 5, y: 4, z: 1 }, STONE).spawn({ x: 4, y: 4, z: 1 })
    .definition();
  await configureWorld(page, setup);
  await page.goto("/?harness=1");
  await ready(page);
  await page.keyboard.down("l");
  await page.keyboard.press("Space");
  await waitFor(
    page,
    () =>
      readWorld(
        page,
        (w) => w.scene.items.some((e) => e.x === 5 && e.y === 4 && e.z === 1),
      ),
    { maxTicks: 40 },
  );
  await page.keyboard.press("Space");
  await page.keyboard.up("l");
  await expect.poll(() =>
    readWorld(
      page,
      (w) => w.scene.inventory.find((s) => s.kind === "stone")?.count,
    )
  ).toBe(1);
});
