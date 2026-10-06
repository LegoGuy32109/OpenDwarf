import process from "node:process";
import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { clickUi, hasUi, qrUrl, ready, say, uiRect, uiState } from "./ui.ts";

test("the host opens the small join QR from the QR button", async ({ page }) => {
  await page.goto("/?harness=1&tools=1");
  await ready(page);
  await expect.poll(() => hasUi(page, "panel:join")).toBe(false);
  await clickUi(page, "btn:qr");
  await expect.poll(() => hasUi(page, "panel:join")).toBe(true);
  // The code loads as a texture the renderer draws.
  await expect.poll(async () => (await uiState(page)).qrReady).toBe(true);
  await expect.poll(() => hasUi(page, "image:qr")).toBe(true);
  await page.waitForTimeout(300);
  await evidenceShot(page, "join-qr-popover");
  const box = await uiRect(page, "image:qr");
  expect(box.w).toBeLessThanOrEqual(168);
  expect(box.w).toBeGreaterThanOrEqual(120);
  await clickUi(page, "btn:qr");
  await expect.poll(() => hasUi(page, "panel:join")).toBe(false);
  await page.keyboard.press("q");
  await expect.poll(() => hasUi(page, "panel:join")).toBe(false);
  await expect.poll(() => hasUi(page, "panel:menu")).toBe(true);
});

test("a phone link joins the expanded authored world directly", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await host.goto("/?harness=1&world=32");
    await ready(host);
    const session = await host.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { sessionId: string } };
      }).__od.scene.sessionId
    );
    expect(await qrUrl(host)).toMatch(
      new RegExp(
        `^http://127\\.0\\.0\\.1:${
          process.env.PORT ?? "8000"
        }/api/v1/qr/${session}\\?link=${
          encodeURIComponent(
            `http://127.0.0.1:${process.env.PORT ?? "8000"}/join/${session}`,
          )
        }$`,
      ),
    );
    await guest.goto(`/join/${session}?harness=1`);
    await ready(guest);
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
    await ready(host);
    const session = await host.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { sessionId: string } } })
        .__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    await ready(guest);
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
    await say(host, "range secret");
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
