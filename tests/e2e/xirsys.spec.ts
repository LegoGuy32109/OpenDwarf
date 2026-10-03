import process from "node:process";
import { expect, test } from "@playwright/test";
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
    await host.goto(`${base}/?harness=1`);
    await ready(host);
    const session = await host.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { sessionId: string } };
      }).__od.scene.sessionId
    );
    await guest.goto(`${base}/join/${session}?harness=1`);
    // The corner NPC is also a player, so wait for the guest's own entity.
    await expect.poll(() =>
      guest.evaluate(() => {
        const { scene } = (globalThis as unknown as {
          __od: {
            scene: {
              localId: string;
              world: { players: Record<string, unknown> };
            };
          };
        }).__od;
        return scene.localId.startsWith("peer-") &&
          scene.localId in scene.world.players;
      }), { timeout: 30_000 }).toBe(true);
    expect(sockets[0]).toContain("xirsys");
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});
