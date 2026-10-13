import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { waitTicks } from "./time.ts";
import { clickUi, ready, say } from "./ui.ts";

type Chatter = {
  speaker: string;
  length: number;
  syllables: number;
  gain: number;
  volume: number;
  murmur: boolean;
};
type Odd = {
  __od: {
    chatter: { log: Chatter[]; level(): string };
    scene: {
      sessionId: string;
      localId: string;
      world: { players: Record<string, { x: number; y: number }> };
    };
  };
};

const chatterLog = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Odd).__od.chatter.log.slice());

/** Host and guest in one world; the host has pressed a key, so its audio is on. */
async function pair(browser: import("@playwright/test").Browser) {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  await host.keyboard.press("Shift");
  const session = await host.evaluate(() =>
    (globalThis as unknown as Odd).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    guest.evaluate(() => (globalThis as unknown as Odd).__od.scene.localId)
  ).toMatch(/^peer-/);
  const guestId = await guest.evaluate(() =>
    (globalThis as unknown as Odd).__od.scene.localId
  );
  return { host, guest, guestId };
}

test("with Voices Off nothing is logged, and the Voices row saves its choice", async ({ browser }) => {
  const { host, guest } = await pair(browser);
  try {
    await host.keyboard.press("Escape");
    await clickUi(host, "btn:settings");
    await evidenceShot(host, "voices-settings");
    await clickUi(host, "btn:voices:off");
    await expect.poll(() =>
      host.evaluate(() => (globalThis as unknown as Odd).__od.chatter.level())
    ).toBe("off");
    expect(
      await host.evaluate(() => localStorage.getItem("open-dwarf-voices")),
    ).toBe("off");
    await clickUi(host, "btn:back");
    await host.keyboard.press("Escape");
    await say(guest, "Hello there friend");
    // The bubble reaches the host, and still nothing plays.
    await expect.poll(() =>
      host.evaluate(() =>
        (globalThis as unknown as {
          __od: { scene: { chatFeed: { text?: string }[] } };
        }).__od.scene.chatFeed.some((record) =>
          record.text === "Hello there friend"
        )
      )
    ).toBe(true);
    await waitTicks(host, 30);
    expect(await chatterLog(host)).toEqual([]);
  } finally {
    await host.close();
    await guest.close();
  }
});
