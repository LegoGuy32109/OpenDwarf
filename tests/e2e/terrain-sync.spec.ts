import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { hasUi, ready, uiState } from "./ui.ts";
const chunkKeys = (page: Page) =>
  readWorld(page, (__world) =>
    [...__world.scene.world.chunks.keys()]
      .sort());
/**
 * An open level-0 tile in a loaded chunk of column `cx`, or null. A player
 * placed in stone is pushed back by collision, so the walk needs open ground.
 */
const openTile = (host: Page, cx: number) =>
  readWorld(host, (__world, cx) => {
    const chunks = __world.scene.world.chunks;
    for (const cy of [0, -1, 1]) {
      const chunk = chunks.get(`${cx},${cy}`);
      if (!chunk) {
        continue;
      }
      for (let i = 0; i < 256; i++) {
        if (chunk[i] === 1) {
          return { x: cx * 16 + (i % 16), y: cy * 16 + Math.floor(i / 16), cy };
        }
      }
    }
    return null;
  }, cx);
/** Move the host's player, or its guest's player, to a tile, as if it had walked there. */
const place = (host: Page, own: boolean, x: number, y: number) =>
  readWorld(host, (__world, [own, x, y]) => {
    const scene = __world.scene;
    for (const [id, player] of Object.entries(scene.world.players)) {
      if ((id === scene.localId) === own && !id.startsWith("npc")) {
        __world.edit({
          players: [{
            id: player.id,
            at: {
              x: x,
              y: y,
              z: 0,
            },
          }],
        });
      }
    }
  }, [own, x, y] as const);
/** Wait until every player named by `own` stands in chunk column `cx`. */
const stands = (host: Page, own: boolean, cx: number) =>
  readWorld(host, (__world, [own, cx]) => {
    const scene = __world.scene;
    return Object.entries(scene.world.players).filter(([id]) =>
      (id === scene.localId) === own && !id.startsWith("npc")
    ).every(([, player]) => Math.floor(player.x / 16) === cx);
  }, [own, cx] as const);
test("a guest that explores keeps its remembered terrain, and the host reports it", async ({ browser }) => {
  const host = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1&seed=beta");
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    readWorld(host, (__world) =>
      Object.keys(__world.scene.world.players)
        .some((id) => id.startsWith("peer-")))
  ).toBe(true);
  // Walk the host's player and the guest east, one chunk at a time.
  for (let cx = 1; cx <= 6; cx++) {
    // The host generates around its own player first, so the guest's sight
    // finds the chunks loaded when it arrives. Each step needs open ground in
    // a chunk the previous step generated.
    await expect.poll(() => openTile(host, cx)).not.toBeNull();
    const spot = (await openTile(host, cx))!;
    await place(host, true, spot.x, spot.y);
    await expect.poll(() => stands(host, true, cx)).toBe(true);
    await expect.poll(() => chunkKeys(host)).toContain(`${cx + 1},${spot.cy}`);
    await place(host, false, spot.x, spot.y);
    await expect.poll(() => stands(host, false, cx)).toBe(true);
    await expect.poll(() => chunkKeys(guest)).toContain(`${cx},${spot.cy}`);
  }
  // The guest's own copy and the host's remembered terrain for it agree.
  const hostCount = () =>
    readWorld(host, async (__world) =>
      (await __world.hostStats())!
        .connections[0].rememberedChunks);
  await expect.poll(async () => (await chunkKeys(guest)).length).toBe(
    await hostCount(),
  );
  expect((await chunkKeys(guest)).length).toBeGreaterThan(6);
  // The F3 panel shows the remembered line.
  await host.keyboard.press("F3");
  await expect.poll(() => hasUi(host, "panel:diagnostics")).toBe(true);
  await expect.poll(async () => (await uiState(host)).diagnostics).toMatch(
    /Remembered \d+/,
  );
  await evidenceShot(host, "host-diagnostics-remembered");
  await Promise.all([host.close(), guest.close()]);
});
