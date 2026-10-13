import { openWorld, readWorld } from "./world.ts";
import process from "node:process";
import { expect, test } from "./fixtures.ts";
import { ready } from "./ui.ts";
const configured = Boolean(
  process.env.XIRSYS_IDENT && process.env.XIRSYS_SECRET &&
    process.env.XIRSYS_CHANNEL,
);
// playwright.config.ts starts a second shell on this port when credentials are set.
const base = `http://127.0.0.1:${Number(process.env.PORT ?? "8000") + 1}`;
test.skip(
  !configured,
  "XIRSYS_IDENT, XIRSYS_SECRET, and XIRSYS_CHANNEL are not set",
);
test("a host and a guest connect through real Xirsys", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const sockets: string[] = [];
  guest.on("websocket", (socket) => sockets.push(socket.url()));
  try {
    await openWorld(host, `${base}/?harness=1`);
    await ready(host);
    const session = await readWorld(host, (__world) => __world.scene.sessionId);
    await openWorld(guest, `${base}/join/${session}?harness=1`);
    // The corner NPC is also a player, so wait for the guest's own entity.
    await expect.poll(() =>
      readWorld(guest, (__world) => {
        const { scene } = __world;
        return scene.localId.startsWith("peer-") &&
          scene.localId in scene.world.players;
      })
    ).toBe(true);
    expect(sockets[0]).toContain("xirsys");
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});
