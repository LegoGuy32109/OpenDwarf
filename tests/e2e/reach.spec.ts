import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";
test("a guest sees an item dropped around a corner once its floor is visible", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1");
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() => readWorld(guest, (__world) => __world.scene.localId))
    .toMatch(/^peer-/);
  const guestId = await readWorld(guest, (__world) => __world.scene.localId);
  // A pillar north of the guest: the open tiles beside it are not in sight, but
  // the floor under them is. It goes in with the room, before the guest moves
  // in, so the host's first sight from the new tile already has it.
  await readWorld(host, (__world, who) => {
    const terrain = __world.materials;
    const scene = __world.scene;
    for (let y = 3; y <= 9; y++) {
      for (let x = 3; x <= 9; x++) {
        __world.edit({
          tiles: [{
            bounds: {
              minX: x,
              maxX: x,
              minY: y,
              maxY: y,
              minZ: 0,
              maxZ: 0,
            },
            material: terrain.STONE,
          }],
        });
        __world.edit({
          tiles: [{
            bounds: {
              minX: x,
              maxX: x,
              minY: y,
              maxY: y,
              minZ: 1,
              maxZ: 1,
            },
            material: terrain.OPEN,
          }],
        });
        __world.edit({
          tiles: [{
            bounds: {
              minX: x,
              maxX: x,
              minY: y,
              maxY: y,
              minZ: 2,
              maxZ: 2,
            },
            material: terrain.STONE,
          }],
        });
      }
    }
    __world.edit({
      tiles: [{
        bounds: {
          minX: 6,
          maxX: 6,
          minY: 5,
          maxY: 5,
          minZ: 1,
          maxZ: 1,
        },
        material: terrain.STONE,
      }],
    });
    __world.edit({
      players: [{
        id: scene.world.players[who].id,
        at: {
          x: 6,
          y: 6,
          z: 1,
        },
      }],
    });
  }, guestId);
  await expect.poll(() =>
    readWorld(guest, (__world) => __world.scene.visibility.visible.has("6,6,1"))
  ).toBe(true);
  await readWorld(host, (__world) => {
    __world.edit({
      drops: [{
        at: { x: 7, y: 5, z: 1 },
        kind: "coal",
        count: 1,
      }],
    });
    __world.edit({
      drops: [{
        at: { x: 7, y: 3, z: 1 },
        kind: "coal",
        count: 1,
      }],
    });
  });
  const seen = () =>
    readWorld(
      guest,
      (__world) =>
        __world.scene.items.map((item) => `${item.x},${item.y},${item.z}`),
    );
  await expect.poll(seen).toContain("7,5,1");
  expect(await seen()).not.toContain("7,3,1");
  await evidenceShot(guest, "reach-item-around-corner");
  await Promise.all([host.close(), guest.close()]);
});
