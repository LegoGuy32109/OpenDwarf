import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { holdUntil, waitTicks } from "./time.ts";
import { ready } from "./ui.ts";
type Played = {
  tags: string[];
  x: number;
  y: number;
  z: number;
  muffled: boolean;
  own: boolean;
};
const sounds = (page: Page) =>
  readWorld(page, (__world) => [...__world.sounds]);
const position = (page: Page) =>
  readWorld(page, (__world) => {
    const scene = __world.scene;
    return scene.world.players[scene.localId];
  });
/** Stand the host's player still at a position. */
const placeAt = (page: Page, x: number, y: number) =>
  readWorld(page, (__world, [px, py]) => {
    const scene = __world.scene;
    const player = scene.world.players[scene.localId];
    __world.edit({
      players: [{
        id: player.id,
        at: {
          x: px,
          y: py,
          z: player.z,
        },
      }],
    });
  }, [x, y]);
const isStep = (sound: Played, own: boolean) =>
  sound.tags[0] === "step" && sound.own === own;
/** Open a host and a guest that joined it. */
async function pair(browser: import("@playwright/test").Browser) {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1");
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  return { host, guest };
}
test("each hears its own steps as own, and the other hears them in range", async ({ browser }) => {
  const { host, guest } = await pair(browser);
  const hostSteps = async () =>
    (await sounds(guest)).filter((sound) =>
      isStep(sound, false) && sound.y > 5
    );
  const ownSteps = async (page: Page) =>
    (await sounds(page)).filter((sound) => isStep(sound, true)).length;
  // Walk west along the row the guest stands on until the guest hears two steps.
  // The corner NPC steps too, far away at y 3.
  await holdUntil(
    host,
    "s",
    async () => (await hostSteps()).length >= 2 && (await ownSteps(host)) >= 2,
  );
  const heard = await hostSteps();
  expect(heard[0].tags.slice(0, 2)).toEqual(["step", "walk"]);
  expect(heard[0].tags).toHaveLength(3);
  expect(heard.every((sound) => !sound.muffled)).toBe(true);
  const own = (await sounds(host)).filter((sound) => isStep(sound, true));
  expect(own.length).toBeGreaterThanOrEqual(2);
  // The host does not hear its own steps twice: its events come from the host's record, not itself.
  expect(
    (await sounds(host)).some((sound) => isStep(sound, false) && sound.y > 5),
  ).toBe(false);
  await holdUntil(guest, "e", async () => (await ownSteps(guest)) >= 2);
  await expect.poll(async () =>
    (await sounds(host)).filter((sound) => isStep(sound, false)).length
  ).toBeGreaterThanOrEqual(2);
  await evidenceShot(guest, "sound-events-steps");
  await Promise.all([host.close(), guest.close()]);
});
test("a source behind rock is muffled, one beyond 12 tiles is not heard", async ({ browser }) => {
  const { host, guest } = await pair(browser);
  // A stone wall between the host's side and the guest, across the whole room.
  await readWorld(host, (__world) => {
    const terrain = __world.materials;
    for (let y = 3; y <= 14; y++) {
      __world.edit({
        tiles: [{
          bounds: {
            minX: 5,
            maxX: 5,
            minY: y,
            maxY: y,
            minZ: 0,
            maxZ: 0,
          },
          material: terrain.STONE,
        }],
      });
    }
  });
  await placeAt(host, 2, 9);
  await expect.poll(async () => (await position(guest))?.x).toBeGreaterThan(5);
  await waitTicks(host, 10);
  const before = (await sounds(guest)).length;
  await holdUntil(
    host,
    "e",
    async () =>
      (await sounds(guest)).slice(before).filter((sound) => sound.x < 5)
        .length >= 2,
  );
  const behind = (await sounds(guest)).slice(before).filter((sound) =>
    sound.x < 5
  );
  expect(behind.every((sound) => sound.muffled)).toBe(true);
  await evidenceShot(guest, "sound-events-muffled");
  // The guest walks to the far west, the host to the far east: more than 12 tiles apart.
  await readWorld(host, (__world) => {
    const terrain = __world.materials;
    for (let y = 3; y <= 14; y++) {
      __world.edit({
        tiles: [{
          bounds: {
            minX: 5,
            maxX: 5,
            minY: y,
            maxY: y,
            minZ: 0,
            maxZ: 0,
          },
          material: terrain.OPEN,
        }],
      });
    }
  });
  await holdUntil(
    guest,
    "s",
    async () => ((await position(guest))?.x ?? 99) < 2.6,
  );
  await placeAt(host, 14.6, 13);
  await waitTicks(host, 10);
  expect(Math.abs((await position(host))!.x - (await position(guest))!.x))
    .toBeGreaterThan(12);
  const mark = (await sounds(guest)).length;
  const hostMark = (await sounds(host)).length;
  await holdUntil(
    host,
    "e",
    async () =>
      (await sounds(host)).slice(hostMark).filter((sound) =>
        isStep(sound, true)
      )
        .length >= 2,
  );
  // Give the host's step events time to reach the guest, if they were sent.
  await waitTicks(guest, 20);
  expect((await sounds(guest)).slice(mark).filter((sound) => sound.x > 9))
    .toEqual([]);
  await Promise.all([host.close(), guest.close()]);
});
