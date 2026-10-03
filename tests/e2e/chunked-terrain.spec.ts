import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

type Harness = {
  __od: {
    scene: {
      sessionId: string;
      world: {
        chunks: Map<string, Uint8Array>;
        players: Record<string, { x: number; y: number; z: number }>;
      };
      localId: string;
    };
  };
};

const chunkKeys = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    [...(globalThis as unknown as Harness).__od.scene.world.chunks.keys()]
      .sort()
  );

test("host and guest see the authored chunk as one world", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await expect(host.locator("#loading")).toBeHidden();
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await expect(guest.locator("#loading")).toBeHidden();
  await expect.poll(() => chunkKeys(guest)).toEqual(["0,0"]);
  expect(await chunkKeys(host)).toEqual(["0,0"]);
  await expect.poll(() =>
    guest.evaluate(() => {
      const scene = (globalThis as unknown as Harness).__od.scene;
      return scene.world.players[scene.localId]?.z;
    })
  ).toBe(0);
  await host.waitForTimeout(500);
  await evidenceShot(host, "host-start");
  await evidenceShot(guest, "guest-start");
  await Promise.all([host.close(), guest.close()]);
});

test("a guest walks across a chunk border in the expanded authored world", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1&world=32");
  await expect(host.locator("#loading")).toBeHidden();
  expect(await chunkKeys(host)).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await expect(guest.locator("#loading")).toBeHidden();
  await expect.poll(() => chunkKeys(guest)).toContain("0,0");
  const guestX = () =>
    guest.evaluate(() => {
      const scene = (globalThis as unknown as Harness).__od.scene;
      return scene.world.players[scene.localId]?.x ?? -1;
    });
  await guest.keyboard.down("f");
  await expect.poll(guestX, { timeout: 30_000 }).toBeGreaterThan(14);
  await evidenceShot(guest, "guest-before-border");
  await expect.poll(guestX, { timeout: 30_000 }).toBeGreaterThan(17);
  await guest.keyboard.up("f");
  // The guest now stands in chunk 1,0 and has received it.
  await expect.poll(() => chunkKeys(guest)).toContain("1,0");
  await host.waitForTimeout(500);
  await evidenceShot(guest, "guest-across-border");
  await evidenceShot(host, "host-across-border");
  await Promise.all([host.close(), guest.close()]);
});
