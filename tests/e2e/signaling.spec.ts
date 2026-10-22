import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";
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
      await openWorld(host, "/?harness=1");
      await ready(host);
      const session = await readWorld(
        host,
        (__world) => __world.scene.sessionId,
      );
      await openWorld(guest, `/join/${session}?harness=1`);
      await ready(guest);
      // The corner NPC is also a player, so wait for the guest's own entity.
      await expect.poll(() =>
        readWorld(guest, (__world) => {
          const { scene } = __world;
          return scene.localId.startsWith("peer-") &&
            scene.localId in scene.world.players;
        })
      ).toBe(true);
      await expect.poll(() =>
        readWorld(host, (__world) => {
          const { scene } = __world;
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
