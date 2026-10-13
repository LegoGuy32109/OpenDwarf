import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type Entry = { id: string; x: number; y: number; z: number; progress: number };
type Item = { x: number; y: number; z: number };
type Harness = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      viewZ: number;
      mining: Entry[];
      items: Item[];
      world: {
        players: Record<string, Record<string, number>>;
      };
    };
  };
};

test("a guest sees an item dropped around a corner once its floor is visible", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    guest.evaluate(() => (globalThis as unknown as Harness).__od.scene.localId)
  ).toMatch(/^peer-/);
  const guestId = await guest.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.localId
  );
  // A pillar north of the guest: the open tiles beside it are not in sight, but
  // the floor under them is. It goes in with the room, before the guest moves
  // in, so the host's first sight from the new tile already has it.
  await host.evaluate(async (who) => {
    const terrain = await import("/src/shared/terrain.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    for (let y = 3; y <= 9; y++) {
      for (let x = 3; x <= 9; x++) {
        terrain.writeTile(scene.world, x, y, 0, terrain.STONE);
        terrain.writeTile(scene.world, x, y, 1, terrain.OPEN);
        terrain.writeTile(scene.world, x, y, 2, terrain.STONE);
      }
    }
    terrain.writeTile(scene.world, 6, 5, 1, terrain.STONE);
    Object.assign(scene.world.players[who], {
      x: 6,
      y: 6,
      z: 1,
      previousX: 6,
      previousY: 6,
    });
  }, guestId);
  await expect.poll(() =>
    guest.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { visibility: { visible: Set<string> } } };
      }).__od.scene.visibility.visible.has("6,6,1")
    )
  ).toBe(true);
  await host.evaluate(async () => {
    const items = await import("/src/shared/items.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    items.dropItem(scene.world, { x: 7, y: 5, z: 1 }, "coal", 1);
    items.dropItem(scene.world, { x: 7, y: 3, z: 1 }, "coal", 1);
  });
  const seen = () =>
    guest.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.items.map((item) =>
        `${item.x},${item.y},${item.z}`
      )
    );
  await expect.poll(seen).toContain("7,5,1");
  expect(await seen()).not.toContain("7,3,1");
  await evidenceShot(guest, "reach-item-around-corner");
  await Promise.all([host.close(), guest.close()]);
});
