import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { waitTicks } from "./time.ts";
import { clickUi, ready, say } from "./ui.ts";
const chatterLog = (page: Page) =>
  readWorld(page, (__world) => __world.chatter.log.slice());
/** Host and guest in one world; the host has pressed a key, so its audio is on. */
async function pair(browser: import("@playwright/test").Browser) {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1");
  await ready(host);
  await host.keyboard.press("Shift");
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() => readWorld(guest, (__world) => __world.scene.localId))
    .toMatch(/^peer-/);
  const guestId = await readWorld(guest, (__world) => __world.scene.localId);
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
      readWorld(host, (__world) => __world.chatter.level())
    ).toBe("off");
    expect(await host.evaluate(() => localStorage.getItem("open-dwarf-voices")))
      .toBe("off");
    await clickUi(host, "btn:back");
    await host.keyboard.press("Escape");
    await say(guest, "Hello there friend");
    // The bubble reaches the host, and still nothing plays.
    await expect.poll(() =>
      readWorld(
        host,
        (__world) =>
          __world.scene.chatFeed.some((record) =>
            record.text === "Hello there friend"
          ),
      )
    ).toBe(true);
    await waitTicks(host, 30);
    expect(await chatterLog(host)).toEqual([]);
  } finally {
    await host.close();
    await guest.close();
  }
});
