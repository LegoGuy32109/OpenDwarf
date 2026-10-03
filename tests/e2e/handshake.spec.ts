import { expect, test } from "@playwright/test";

test("unanswered offer expires without leaving a player or connection record", async ({ page }) => {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
  const session = await page.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } })
      .__od.scene.sessionId
  );
  // Join through the relay as a peer that never answers the host's offer.
  await page.evaluate(async (session) => {
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
          version: 3,
        },
      },
    }));
  }, session);
  const stats = () =>
    page.evaluate(async () => {
      const game = (globalThis as unknown as {
        __od: {
          hostStats: () => Promise<
            { joinFailures: number; players: number; connections: unknown[] }
          >;
        };
      }).__od;
      return await game.hostStats();
    });
  await expect.poll(async () => (await stats()).connections.length).toBe(1);
  await expect.poll(async () => (await stats()).joinFailures, {
    timeout: 15_000,
  }).toBe(1);
  expect((await stats()).connections).toEqual([]);
});
