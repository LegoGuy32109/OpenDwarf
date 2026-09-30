import { expect, test } from "@playwright/test";

test("unanswered offer expires without leaving a player or connection record", async ({ page }) => {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
  const session = await page.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } })
      .__od.scene.sessionId
  );
  const playerId = `peer-${crypto.randomUUID()}`;
  const response = await page.request.post(`/api/signal/${session}/host`, {
    data: {
      id: crypto.randomUUID(),
      from: playerId,
      kind: "join",
      data: {
        playerId,
        token: crypto.randomUUID(),
        attempt: crypto.randomUUID(),
        version: 2,
      },
    },
  });
  expect(response.ok()).toBe(true);
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
