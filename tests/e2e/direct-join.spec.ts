import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

test("the host opens the small join QR from the QR button", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#join-panel")).toBeHidden();
  await page.locator("#join-toggle").click();
  await expect(page.locator("#join-panel")).toBeVisible();
  await expect(page.locator("#join-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect.poll(() =>
    page.locator("#join-code").evaluate((image: HTMLImageElement) =>
      image.complete && image.naturalWidth > 0
    )
  ).toBe(true);
  await evidenceShot(page, "join-qr-popover");
  const box = await page.locator("#join-code").boundingBox();
  expect(box?.width).toBeLessThanOrEqual(144);
  await page.locator("#join-toggle").click();
  await expect(page.locator("#join-panel")).toBeHidden();
  await page.keyboard.press("q");
  await expect(page.locator("#join-panel")).toBeVisible();
});

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
              world: { chunks: Map<string, unknown> };
            };
          };
        }).__od.scene;
        return {
          id: scene.localId,
          chunks: [...scene.world.chunks.keys()].sort(),
        };
      })
    ).toMatchObject({
      id: expect.stringMatching(/^peer-/),
      chunks: expect.arrayContaining(["0,0"]),
    });
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});

test("guest receives talking activity before nearby message text", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await host.goto("/?harness=1");
    await expect(host.locator("#loading")).toBeHidden();
    const session = await host.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { sessionId: string } } })
        .__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    await expect(guest.locator("#loading")).toBeHidden();
    await expect.poll(
      () =>
        guest.evaluate(() =>
          (globalThis as unknown as { __od: { scene: { localId: string } } })
            .__od.scene.localId
        ),
      { timeout: 15_000 },
    ).toMatch(/^peer-/);
    await host.evaluate(() => {
      const world = (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { x: number } } } } };
      }).__od.scene.world;
      world.players.self.x = 14;
    });
    await host.keyboard.press("t");
    await host.locator("#chat-input").fill("range secret");
    await host.locator("#chat-input").press("Enter");
    await expect.poll(() =>
      guest.evaluate(() => {
        const scene = (globalThis as unknown as {
          __od: {
            scene: {
              chatFeed: { id: string; talking?: boolean; text?: string }[];
              world: { players: { self?: { message: string } } };
            };
          };
        }).__od.scene;
        return {
          talking: scene.chatFeed.find((record) => record.id === "self")
            ?.talking,
          leaked: scene.world.players.self?.message ?? "",
        };
      })
    ).toEqual({ talking: true, leaked: "" });
    await host.evaluate(() => {
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { x: number } } } } };
      }).__od.scene.world.players.self.x = 11;
    });
    await expect.poll(() =>
      guest.evaluate(() =>
        (globalThis as unknown as {
          __od: { scene: { chatFeed: { id: string; text?: string }[] } };
        }).__od.scene.chatFeed.find((record) => record.id === "self")?.text
      )
    ).toBe("range secret");
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});
