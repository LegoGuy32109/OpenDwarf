import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { waitFrames, waitTicks } from "./time.ts";
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
  // Let the frame already in flight finish, so only the background clock
  // steps now. A hidden page draws no frames, so count its ticks.
  await waitTicks(host, 2);

  const guestStart = await position(host, guestId);
  const npcStart = await position(guest, "npc-corner");
  await guest.keyboard.down("e");
  try {
    // The hidden host keeps ticking: it accepts the guest's moves, and the
    // guest sees the NPC move.
    await expect.poll(async () => {
      const guestNow = await position(host, guestId);
      return Math.hypot(
        guestNow!.x - guestStart!.x,
        guestNow!.y - guestStart!.y,
      );
    }).toBeGreaterThan(1);
    await expect.poll(() => position(guest, "npc-corner"))
      .not.toEqual(npcStart);
  } finally {
    await guest.keyboard.up("e");
  }
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

  // Showing the host again resumes frames. A frame spends at most 250 ms of
  // catch-up, so the hidden time cannot come back as a burst of ticks.
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
  // With the background clock stopped, only frames step the world now.
  await waitFrames(host, 2);
  await waitTicks(host, 10);
  await host.close();
});
