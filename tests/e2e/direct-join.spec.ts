import { expect, test } from "@playwright/test";

test("a phone link joins the expanded authored world directly", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await host.goto("/?harness=1&world=32");
    await expect(host.locator("#loading")).toBeHidden();
    const session = await host.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { sessionId: string } };
      }).__od.scene.sessionId
    );
    await expect(host.locator("#join-code")).toHaveAttribute(
      "src",
      `/api/qr/${session}`,
    );
    await guest.goto(`/join/${session}?harness=1`);
    await expect(guest.locator("#loading")).toBeHidden();
    await expect.poll(() =>
      guest.evaluate(() => {
        const scene = (globalThis as unknown as {
          __od: {
            scene: {
              localId: string;
              world: { edge: number; chunks: string[] };
            };
          };
        }).__od.scene;
        return {
          id: scene.localId,
          edge: scene.world.edge,
          chunks: scene.world.chunks,
        };
      })
    ).toMatchObject({
      id: expect.stringMatching(/^peer-/),
      edge: 32,
      chunks: ["0,0", "1,0", "0,1", "1,1"],
    });
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});
