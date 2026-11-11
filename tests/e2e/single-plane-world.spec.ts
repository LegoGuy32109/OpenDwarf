import { expect, test } from "./fixtures.ts";
import { openWorld, readWorld } from "./world.ts";
import { ready } from "./ui.ts";
import { holdTicks } from "./time.ts";
import { evidenceShot } from "./evidence.ts";

test.use({ viewport: { width: 390, height: 844 } });

test("spawn room movement stays on its plane and walls refuse climbing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openWorld(page, "/?harness=1&layout=room");
  await ready(page);
  const position = () =>
    readWorld(page, (world) => {
      const player = world.scene.world.players[world.scene.localId];
      return {
        x: player.x,
        y: player.y,
        z: player.z,
        facing: player.facing,
        plane: world.scene.world.planeZ,
        move: player.move,
      };
    });
  expect(await position()).toMatchObject({
    x: 16,
    y: 15,
    z: 1,
    plane: 1,
    facing: { x: 0, y: 1 },
  });
  await page.locator("#world").click();
  // Walk west into the room wall, then turn while blocked.
  await holdTicks(page, "s", 110);
  const blocked = await position();
  expect(blocked.z).toBe(1);
  expect(blocked.x).toBeGreaterThan(11.7);
  expect(blocked.x).toBeLessThan(12.1);
  expect(blocked.move).toBeNull();
  expect(blocked.facing).toEqual({ x: -1, y: 0 });
  await evidenceShot(page, "130-planar-room-wall");
  await holdTicks(page, "f", 35);
  expect((await position()).x).toBeGreaterThan(blocked.x + 1);
  expect((await position()).z).toBe(1);
  await evidenceShot(page, "130-planar-room-walk");
  expect(errors).toEqual([]);
});

test("guests receive the host's planar terrain without generating their own caves", async ({ browser, page: guest }) => {
  const host = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openWorld(host, "/?harness=1&layout=room");
    await ready(host);
    const session = await readWorld(host, (world) => world.scene.sessionId);
    await openWorld(guest, `/join/${session}?harness=1`);
    await ready(guest);
    await expect.poll(() =>
      readWorld(
        guest,
        (world) =>
          world.scene.localId.startsWith("peer-") &&
          world.scene.localId in world.scene.world.players,
      )
    ).toBe(true);
    const hostChunks = await readWorld(
      host,
      (world) =>
        Object.fromEntries(
          [...world.scene.world.chunks].map((
            [key, chunk],
          ) => [key, Array.from(chunk)]),
        ),
    );
    const data = await readWorld(guest, (world) => ({
      z: world.scene.world.players[world.scene.localId]?.z,
      generates: Boolean(world.scene.world.generateChunk),
      floorStyle: world.scene.world.floorStyle,
      chunks: Object.fromEntries(
        [...world.scene.world.chunks].map((
          [key, chunk],
        ) => [key, Array.from(chunk)]),
      ),
    }));
    expect(data.z).toBe(1);
    expect(data.generates).toBe(false);
    expect(data.floorStyle).toBe("spawn-room");
    const guestPalette = await readWorld(guest, async (api) => {
      const { surfaceAt } = await import("../../src/shared/surface.js");
      const sample = (x: number, y: number) =>
        surfaceAt(api.scene.world, x, y, 1, "master", api.scene.visibility)!
          .authoredFloor;
      return {
        room: sample(16, 15),
        wall: sample(11, 15),
        tunnel: sample(21, 12),
      };
    });
    expect(guestPalette).toEqual({ room: true, wall: false, tunnel: false });
    let known = 0;
    for (const [key, chunk] of Object.entries(data.chunks)) {
      for (let index = 0; index < chunk.length; index++) {
        if (chunk[index] === 0) continue;
        known++;
        expect(chunk[index], `${key}:${index}`).toBe(hostChunks[key][index]);
      }
    }
    expect(known).toBeGreaterThan(40);
    await evidenceShot(guest, "130-planar-guest-room");
  } finally {
    await host.close();
    await guest.close();
  }
});
