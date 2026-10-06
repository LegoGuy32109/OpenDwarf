import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { clickUi, ready, say } from "./ui.ts";

type Od = {
  scene: {
    sessionId: string;
    localId: string;
    chatFeed: { id: string; text?: string }[];
    world: {
      tick: number;
      players: Record<string, { x: number; y: number; z: number }>;
    };
  };
};

const tick = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as { __od: Od }).__od.scene.world.tick
  );
const position = (page: Page, id: string) =>
  page.evaluate((id) => {
    const player =
      (globalThis as unknown as { __od: Od }).__od.scene.world.players[id];
    return player ? { x: player.x, y: player.y, z: player.z } : null;
  }, id);

test("a hidden host keeps the world running for a guest", async ({ browser, page: guest }) => {
  // The guest is the test's own page, so its video is the evidence.
  const host = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: Od }).__od.scene.sessionId
  );
  await guest.goto("/host?harness=1");
  await ready(guest);
  await clickUi(guest, `btn:session:${session}`);
  await expect.poll(
    () =>
      guest.evaluate(() =>
        (globalThis as unknown as { __od: Od }).__od.scene.localId
      ),
    {
      timeout: 15_000,
    },
  ).toMatch(/^peer-/);
  const guestId = await guest.evaluate(() =>
    (globalThis as unknown as { __od: Od }).__od.scene.localId
  );
  await expect.poll(() => position(host, guestId)).not.toBeNull();
  await expect.poll(() => position(guest, "npc-corner")).not.toBeNull();

  // Hide the host: no frames, and the page reports itself hidden.
  await host.evaluate(() => {
    const w = globalThis as unknown as {
      __frame?: FrameRequestCallback;
      __realRaf: typeof requestAnimationFrame;
    };
    w.__realRaf = requestAnimationFrame.bind(globalThis);
    globalThis.requestAnimationFrame = (callback) => {
      w.__frame = callback;
      return 0;
    };
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Let the frame already in flight finish, so only the clock steps now.
  await host.waitForTimeout(100);

  const hostStart = await tick(host);
  const guestStart = await position(host, guestId);
  const npcStart = await position(guest, "npc-corner");
  await guest.keyboard.down("e");
  await host.waitForTimeout(3000);
  await guest.keyboard.up("e");
  const ticks = (await tick(host)) - hostStart;
  // 20 ticks a second for about 3 s.
  expect(ticks).toBeGreaterThan(45);
  expect(ticks).toBeLessThan(75);

  // The host accepted the guest's moves.
  const guestEnd = await position(host, guestId);
  expect(Math.hypot(guestEnd!.x - guestStart!.x, guestEnd!.y - guestStart!.y))
    .toBeGreaterThan(1);
  // The guest sees the NPC move.
  const npcEnd = await position(guest, "npc-corner");
  expect(npcEnd).not.toEqual(npcStart);
  await evidenceShot(guest, "background-host-guest");

  // The guest receives the host's chat.
  await say(host, "still here");
  await expect.poll(() =>
    guest.evaluate(() =>
      (globalThis as unknown as { __od: Od }).__od.scene.chatFeed.some((
        record,
      ) => record.text === "still here")
    )
  ).toBe(true);

  // Showing the host again resumes frames without a burst of ticks.
  const before = await tick(host);
  await host.evaluate(() => {
    const w = globalThis as unknown as {
      __frame?: FrameRequestCallback;
      __realRaf: typeof requestAnimationFrame;
    };
    delete (document as unknown as { hidden?: boolean }).hidden;
    delete (document as unknown as { visibilityState?: string })
      .visibilityState;
    globalThis.requestAnimationFrame = w.__realRaf;
    document.dispatchEvent(new Event("visibilitychange"));
    if (w.__frame) requestAnimationFrame(w.__frame);
  });
  await host.waitForTimeout(1000);
  const resumed = (await tick(host)) - before;
  expect(resumed).toBeGreaterThan(10);
  expect(resumed).toBeLessThan(30);
  await host.close();
});
