import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type Played = {
  tags: string[];
  x: number;
  y: number;
  z: number;
  muffled: boolean;
  own: boolean;
};
type Harness = {
  __od: {
    sounds: Played[];
    scene: {
      sessionId: string;
      localId: string;
      world: { players: Record<string, { x: number; y: number; z: number }> };
    };
  };
};

const sounds = (page: Page) =>
  page.evaluate(() => [...(globalThis as unknown as Harness).__od.sounds]);

const position = (page: Page) =>
  page.evaluate(() => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    return scene.world.players[scene.localId];
  });

/** Stand the host's player still at a position. */
const placeAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[scene.localId] as Record<string, number>;
    Object.assign(player, { x: px, y: py, previousX: px, previousY: py });
  }, [x, y]);

const isStep = (sound: Played, own: boolean) =>
  sound.tags[0] === "step" && sound.own === own;

/** Open a host and a guest that joined it. */
async function pair(browser: import("@playwright/test").Browser) {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  return { host, guest };
}

/** Hold a walk key for a while. */
async function walkFor(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test("each hears its own steps as own, and the other hears them in range", async ({ browser }) => {
  test.setTimeout(90_000);
  const { host, guest } = await pair(browser);
  // Walk west along the row the guest stands on. The corner NPC steps too, far away at y 3.
  await walkFor(host, "s", 1800);
  const hostSteps = async () =>
    (await sounds(guest)).filter((sound) =>
      isStep(sound, false) && sound.y > 5
    );
  await expect.poll(async () => (await hostSteps()).length)
    .toBeGreaterThanOrEqual(2);
  const heard = await hostSteps();
  expect(heard[0].tags.slice(0, 2)).toEqual(["step", "walk"]);
  expect(heard[0].tags).toHaveLength(3);
  expect(heard.every((sound) => !sound.muffled)).toBe(true);
  const own = (await sounds(host)).filter((sound) => isStep(sound, true));
  expect(own.length).toBeGreaterThanOrEqual(2);
  // The host does not hear its own steps twice: its events come from the host's record, not itself.
  expect(
    (await sounds(host)).some((sound) => isStep(sound, false) && sound.y > 5),
  ).toBe(
    false,
  );
  await walkFor(guest, "e", 1800);
  await expect.poll(async () =>
    (await sounds(guest)).filter((sound) => isStep(sound, true)).length
  ).toBeGreaterThanOrEqual(2);
  await expect.poll(async () =>
    (await sounds(host)).filter((sound) => isStep(sound, false)).length
  ).toBeGreaterThanOrEqual(2);
  await evidenceShot(guest, "sound-events-steps");
  await Promise.all([host.close(), guest.close()]);
});

test("the guest hears the host mining, and the host hears its own hits and break", async ({ browser }) => {
  test.setTimeout(90_000);
  const { host, guest } = await pair(browser);
  await placeAt(host, 2, 2);
  await host.keyboard.down("i"); // aim north at the stone
  await host.waitForTimeout(150);
  await host.keyboard.press("Space");
  const kinds = (list: Played[], own: boolean) =>
    list.filter((sound) => sound.tags[0] === "mine" && sound.own === own)
      .map((sound) => sound.tags.slice(1).join(" "));
  await expect.poll(async () => kinds(await sounds(guest), false), {
    timeout: 10_000,
  }).toContain("break stone");
  const heard = kinds(await sounds(guest), false);
  // Stone takes 1 s, so a slow frame can leave one hit; the 500 ms cadence is unit tested.
  expect(heard.filter((kind) => kind === "hit stone").length)
    .toBeGreaterThanOrEqual(1);
  expect(heard.at(-1)).toBe("break stone");
  const own = kinds(await sounds(host), true);
  expect(own.filter((kind) => kind === "hit stone").length)
    .toBeGreaterThanOrEqual(1);
  expect(own.at(-1)).toBe("break stone");
  expect(kinds(await sounds(host), false)).toEqual([]);
  await host.keyboard.up("i");
  await Promise.all([host.close(), guest.close()]);
});

test("a source behind rock is muffled, one beyond 12 tiles is not heard", async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest } = await pair(browser);
  // A stone wall between the host's side and the guest, across the whole room.
  await host.evaluate(async () => {
    const terrain = await import("/src/shared/terrain.js");
    const scene = (globalThis as unknown as Harness).__od.scene as unknown as {
      world: Parameters<typeof terrain.writeTile>[0];
    };
    for (let y = 3; y <= 14; y++) {
      terrain.writeTile(scene.world, 5, y, 0, terrain.STONE);
    }
  });
  await placeAt(host, 2, 9);
  await expect.poll(async () => (await position(guest))?.x).toBeGreaterThan(5);
  await host.waitForTimeout(500);
  const before = (await sounds(guest)).length;
  await walkFor(host, "e", 2200);
  await expect.poll(async () =>
    (await sounds(guest)).slice(before).filter((sound) => sound.x < 5).length
  ).toBeGreaterThanOrEqual(2);
  const behind = (await sounds(guest)).slice(before).filter((sound) =>
    sound.x < 5
  );
  expect(behind.every((sound) => sound.muffled)).toBe(true);
  await evidenceShot(guest, "sound-events-muffled");
  // The guest walks to the far west, the host to the far east: more than 12 tiles apart.
  await host.evaluate(async () => {
    const terrain = await import("/src/shared/terrain.js");
    const scene = (globalThis as unknown as Harness).__od.scene as unknown as {
      world: Parameters<typeof terrain.writeTile>[0];
    };
    for (let y = 3; y <= 14; y++) {
      terrain.writeTile(scene.world, 5, y, 0, terrain.OPEN);
    }
  });
  await guest.keyboard.down("s");
  await expect.poll(async () => (await position(guest))?.x, { timeout: 30_000 })
    .toBeLessThan(2.6);
  await guest.keyboard.up("s");
  await placeAt(host, 14.6, 13);
  await host.waitForTimeout(500);
  expect(Math.abs((await position(host))!.x - (await position(guest))!.x))
    .toBeGreaterThan(12);
  const mark = (await sounds(guest)).length;
  const hostMark = (await sounds(host)).length;
  await walkFor(host, "e", 2200);
  expect(
    (await sounds(host)).slice(hostMark).filter((sound) => isStep(sound, true))
      .length,
  ).toBeGreaterThanOrEqual(2);
  expect((await sounds(guest)).slice(mark).filter((sound) => sound.x > 9))
    .toEqual([]);
  await Promise.all([host.close(), guest.close()]);
});
