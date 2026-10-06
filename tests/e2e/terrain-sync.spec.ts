import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { hasUi, ready, uiState } from "./ui.ts";

type Harness = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      world: {
        chunks: Map<string, Uint8Array>;
        players: Record<string, { x: number; y: number; z: number }>;
      };
    };
    hostStats: () => Promise<{ connections: { rememberedChunks: number }[] }>;
  };
};

const chunkKeys = (page: Page) =>
  page.evaluate(() =>
    [...(globalThis as unknown as Harness).__od.scene.world.chunks.keys()]
      .sort()
  );

/** Move the host's player and its guest's player to a tile, as if they had walked there. */
const placeBoth = (host: Page, x: number, y: number) =>
  host.evaluate(([x, y]) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    for (const player of Object.values(scene.world.players)) {
      Object.assign(player, { x, y, z: 0 });
    }
  }, [x, y]);

test("a guest that explores keeps its remembered terrain, and the host reports it", async ({ browser }) => {
  const host = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const guest = await browser.newPage();
  await host.goto("/?harness=1&seed=beta");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    host.evaluate(() =>
      Object.keys((globalThis as unknown as Harness).__od.scene.world.players)
        .some((id) => id.startsWith("peer-"))
    )
  ).toBe(true);
  // Walk the host and the guest east, one chunk at a time.
  for (let cx = 1; cx <= 6; cx++) {
    await placeBoth(host, 8 + 16 * cx, 8);
    await expect.poll(() => chunkKeys(host)).toContain(`${cx + 1},0`);
    await expect.poll(() => chunkKeys(guest), { timeout: 15_000 }).toContain(
      `${cx},0`,
    );
  }
  // The guest's own copy and the host's remembered terrain for it agree.
  const hostCount = () =>
    host.evaluate(async () =>
      (await (globalThis as unknown as Harness).__od.hostStats())
        .connections[0].rememberedChunks
    );
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
