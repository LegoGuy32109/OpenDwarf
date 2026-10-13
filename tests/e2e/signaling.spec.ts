import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type Game = {
  __od: {
    scene: { sessionId: string; localId: string; world: { players: object } };
    dropSignaling?: () => void;
  };
};

test(
  "a host and a guest join through the relay",
  { tag: "@smoke" },
  async ({ page, context }) => {
    // Pages of the test's own context are the ones Playwright records.
    const host = page;
    const guest = await context.newPage();
    const sockets: string[] = [];
    guest.on("websocket", (socket) => sockets.push(socket.url()));
    try {
      await host.goto("/?harness=1");
      await ready(host);
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
  },
);
