import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type Harness = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      world: { players: Record<string, { x: number; y: number; z: number }> };
    };
  };
};

const ROOM = { minX: 12, maxX: 20, minY: 12, maxY: 18, z: 4 };

const position = (page: Page, id?: string) =>
  page.evaluate((who) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[who ?? scene.localId];
    return player ? { x: player.x, y: player.y, z: player.z } : null;
  }, id);

const insideRoom = (p: { x: number; y: number; z: number } | null) =>
  p !== null && p.z === ROOM.z && p.x >= ROOM.minX && p.x <= ROOM.maxX &&
  p.y >= ROOM.minY && p.y <= ROOM.maxY;

/** Hold a key until the local player satisfies the condition. */
async function holdUntil(
  page: Page,
  key: string,
  done: (p: { x: number; y: number; z: number }) => boolean,
) {
  await page.keyboard.down(key);
  await expect.poll(async () => {
    const p = await position(page);
    return p !== null && done(p);
  }, { timeout: 20_000 }).toBe(true);
  await page.keyboard.up(key);
}

test("a host and a joined guest start inside the spawn room", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1&layout=room");
  await ready(host);
  expect(insideRoom(await position(host))).toBe(true);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(async () => insideRoom(await position(guest))).toBe(true);
  // The host sees the guest inside the room too, and the NPC walks there.
  await expect.poll(async () => {
    const id = await guest.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.localId
    );
    return insideRoom(await position(host, id));
  }).toBe(true);
  expect(insideRoom(await position(host, "npc-corner"))).toBe(true);
  await host.waitForTimeout(800);
  await evidenceShot(host, "room-host");
  await evidenceShot(guest, "room-guest");
  await Promise.all([host.close(), guest.close()]);
});

test("the doorway and the stairs work and the tunnel is reachable", async ({ page: host }) => {
  await host.goto("/?harness=1&layout=room");
  await ready(host);
  // South out of the doorway, which opens into solid stone.
  await holdUntil(host, "d", (p) => p.y >= 18.9);
  await host.waitForTimeout(500);
  const doorway = await position(host);
  expect(doorway?.z).toBe(4);
  expect(doorway?.y).toBeGreaterThan(18.8);
  expect(doorway?.y).toBeLessThanOrEqual(19.5);
  await evidenceShot(host, "room-doorway");
  // Back north along the wall, then east over the stairs into the tunnel.
  await holdUntil(host, "e", (p) => p.y <= 12.1);
  await holdUntil(host, "f", (p) => p.x >= 24 && p.z === 2);
  await host.waitForTimeout(500);
  await evidenceShot(host, "room-tunnel");
  expect((await position(host))?.z).toBe(2);
});
