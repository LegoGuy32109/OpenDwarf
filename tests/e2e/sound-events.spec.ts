import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type BrowserContext, type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { holdUntil, waitFor, waitTicks } from "./time.ts";
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
/** Confirm the listener has stopped in both authoritative and predicted state. */
const stationary = (page: Page, id?: string) =>
  readWorld(page, (world, id) => {
    const player = world.scene.world.players[id ?? world.scene.localId];
    return Math.hypot(player.vx ?? 0, player.vy ?? 0) < 0.01;
  }, id);
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
async function pair(host: Page, context: BrowserContext) {
  const guest = await context.newPage();
  await openWorld(host, "/?harness=1");
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    readWorld(guest, (world) => Boolean(world.wireDebug()?.state))
  ).toBe(true);
  return { host, guest };
}
test("each hears its own steps as own, and the other hears them in range", async ({ page, context }) => {
  const { host, guest } = await pair(page, context);
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
test("a source behind rock is muffled, one beyond 12 tiles is not heard", async ({ page, context }) => {
  const { host, guest } = await pair(page, context);
  // Prove the stationary listener sees this tile before the wall changes sight.
  const seesSource = () =>
    readWorld(guest, (world) => world.scene.visibility.visible.has("2,9,0"));
  await expect.poll(seesSource).toBe(true);
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
  expect(await seesSource()).toBe(false);
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
  expect(behind.length).toBeGreaterThanOrEqual(2);
  expect(behind.map((sound) => sound.muffled)).toEqual(
    behind.map(() => true),
  );
  await evidenceShot(guest, "sound-events-muffled");
  // Walk by the host's authoritative listener position, with room for prediction
  // corrections before checking silence beyond the 12-tile hearing range.
  const guestId = await readWorld(guest, (world) => world.scene.localId);
  const listenerX = () =>
    readWorld(host, (world, id) => world.scene.world.players[id].x, guestId);
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
    async () => (await listenerX()) < 1.6,
  );
  await waitFor(host, async () => {
    const [authoritative, predicted] = await Promise.all([
      stationary(host, guestId),
      stationary(guest),
    ]);
    return authoritative && predicted;
  }, { message: "listener stopped on both peers" });
  await placeAt(host, 14.6, 13);
  await waitTicks(host, 10);
  expect(Math.abs((await position(host))!.x - (await listenerX())))
    .toBeGreaterThan(12);
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
