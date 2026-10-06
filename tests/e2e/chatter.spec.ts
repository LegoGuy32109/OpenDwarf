import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
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

/** The gain the host expects for a guest at this distance: full to 2 blocks, 30% at 5. */
async function expectedGain(host: Page, guestId: string) {
  return await host.evaluate((id) => {
    const { players } = (globalThis as unknown as Odd).__od.scene.world;
    const me = players[(globalThis as unknown as Odd).__od.scene.localId];
    const them = players[id];
    const blocks = Math.hypot(me.x - them.x, me.y - them.y);
    return blocks <= 2 ? 1 : 1 - 0.7 * Math.min(1, (blocks - 2) / 3);
  }, guestId);
}

test("a guest who speaks near the host plays one chatter on the host", async ({ browser }) => {
  const { host, guest, guestId } = await pair(browser);
  try {
    await say(guest, "Hello there friend");
    await expect.poll(async () => (await chatterLog(host)).length).toBe(1);
    const [entry] = await chatterLog(host);
    expect(entry.speaker).toBe(guestId);
    expect(entry.murmur).toBe(false);
    expect(entry.length).toBe("Hello there friend".length);
    expect(entry.gain).toBeCloseTo(await expectedGain(host, guestId), 1);
    // The bubble plays once, however long it stays on screen.
    await host.waitForTimeout(1500);
    expect(await chatterLog(host)).toHaveLength(1);
    // The guest's own bubble plays at full volume on the guest.
    await guest.keyboard.press("Shift");
    await say(guest, "Me too");
    await expect.poll(async () => (await chatterLog(guest)).length).toBe(1);
    expect((await chatterLog(guest))[0].gain).toBe(1);
  } finally {
    await host.close();
    await guest.close();
  }
});

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
    await host.waitForTimeout(1500);
    expect(await chatterLog(host)).toEqual([]);
  } finally {
    await host.close();
    await guest.close();
  }
});

test("a speaker who walks out of text range and back plays one chatter, not two", async ({ browser }) => {
  const { host, guest, guestId } = await pair(browser);
  /** Put the guest's player `blocks` east of the host's, on the host's world. */
  const standAt = (blocks: number) =>
    host.evaluate(([id, blocks]) => {
      const { players } = (globalThis as unknown as Odd).__od.scene.world;
      const me = players[(globalThis as unknown as Odd).__od.scene.localId];
      players[id as string].x = me.x + (blocks as number);
      players[id as string].y = me.y;
    }, [guestId, blocks] as const);
  const feedTalking = () =>
    host.evaluate(
      (id) =>
        (globalThis as unknown as {
          __od: { scene: { chatFeed: { id: string; talking?: boolean }[] } };
        }).__od.scene.chatFeed.find((record) => record.id === id)?.talking,
      guestId,
    );
  try {
    await say(guest, "Hello there friend");
    await expect.poll(async () => (await chatterLog(host)).length).toBe(1);
    // Out to the talking range, where the host sees only a murmur indicator.
    await standAt(8);
    await expect.poll(feedTalking).toBe(true);
    await host.waitForTimeout(500);
    // And back into text range.
    await standAt(1);
    await expect.poll(feedTalking).toBeFalsy();
    await host.waitForTimeout(500);
    const log = await chatterLog(host);
    expect(log).toHaveLength(1);
    expect(log[0].murmur).toBe(false);
  } finally {
    await host.close();
    await guest.close();
  }
});
