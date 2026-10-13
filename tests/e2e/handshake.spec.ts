import { PROTOCOL_VERSION } from "../../src/shared/wire.js";
import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { ready } from "./ui.ts";
test("unanswered offer expires without leaving a player or connection record", async ({ page }) => {
  await openWorld(page, "/?harness=1");
  await ready(page);
  const session = await readWorld(page, (__world) => __world.scene.sessionId);
  // Join through the relay as a peer that never answers the host's offer.
  await page.evaluate(async ({ session, version }) => {
    const playerId = `peer-${crypto.randomUUID()}`;
    const ticket = await (await fetch(`/api/v1/sessions/${session}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer: playerId }),
    })).json();
    const socket = new WebSocket(ticket.signalUrl);
    await new Promise((resolve) => socket.addEventListener("open", resolve));
    socket.send(JSON.stringify({
      t: "u",
      m: { f: `${ticket.channel}/${playerId}`, o: "message", t: "host" },
      p: {
        id: crypto.randomUUID(),
        from: playerId,
        kind: "join",
        data: {
          playerId,
          token: crypto.randomUUID(),
          attempt: crypto.randomUUID(),
          version,
        },
      },
    }));
  }, { session, version: PROTOCOL_VERSION });
  const stats = () =>
    readWorld(page, async (__world) => {
      const game = __world;
      return await game.hostStats();
    });
  await expect.poll(async () => (await stats())!.connections.length).toBe(1);
  await expect.poll(async () => (await stats())!.joinFailures, {
    // wall-clock: a join attempt fails after 10 s of real time (attempt-deadline.js).
    timeout: 15000,
  }).toBe(1);
  expect((await stats())!.connections).toEqual([]);
});
