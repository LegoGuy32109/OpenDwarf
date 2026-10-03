import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

type Game = {
  __od: {
    scene: { sessionId: string; localId: string; world: { players: object } };
    dropSignaling?: () => void;
  };
};

test("a host and a guest join through the relay", async ({ page, context }) => {
  // Pages of the test's own context are the ones Playwright records.
  const host = page;
  const guest = await context.newPage();
  const sockets: string[] = [];
  guest.on("websocket", (socket) => sockets.push(socket.url()));
  try {
    await host.goto("/?harness=1");
    await expect(host.locator("#loading")).toBeHidden();
    const session = await host.evaluate(() =>
      (globalThis as unknown as Game).__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    // The corner NPC is also a player, so wait for the guest's own entity.
    await expect.poll(() =>
      guest.evaluate(() => {
        const { scene } = (globalThis as unknown as Game).__od;
        return scene.localId.startsWith("peer-") &&
          scene.localId in scene.world.players;
      })
    ).toBe(true);
    await expect.poll(() =>
      host.evaluate(() => {
        const { scene } = (globalThis as unknown as Game).__od;
        return Object.keys(scene.world.players).some((id) =>
          id.startsWith("peer-")
        );
      })
    ).toBe(true);
    expect(sockets.length).toBeGreaterThan(0);
    expect(sockets[0]).toMatch(/\/v2\//);
    await evidenceShot(guest, "joined-through-relay");
  } finally {
    await guest.close();
  }
});

test("a guest that loses its signaling socket reconnects with a new token", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const joins: string[] = [];
  const sockets: string[] = [];
  guest.on("request", (request) => {
    if (request.url().endsWith("/join")) joins.push(request.url());
  });
  guest.on("websocket", (socket) => sockets.push(socket.url()));
  try {
    await host.goto("/?harness=1");
    await expect(host.locator("#loading")).toBeHidden();
    const session = await host.evaluate(() =>
      (globalThis as unknown as Game).__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    await expect.poll(() => sockets.length).toBe(1);
    await guest.evaluate(() =>
      (globalThis as unknown as Game).__od.dropSignaling?.()
    );
    await expect.poll(() => sockets.length).toBe(2);
    expect(joins.length).toBe(2);
    expect(sockets[1]).not.toBe(sockets[0]);
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});
