import { openWorld, placePlayer, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { waitFor, waitFrames, waitTicks } from "./time.ts";
import { ready, say, shopOpen } from "./ui.ts";
const ASK = "What do you buy?";
const localId = (page: Page) =>
  readWorld(page, (__world) => __world.scene.localId);
/** The chat lines a page has heard, as "speaker: text". */
const heard = (page: Page) =>
  readWorld(page, (__world) =>
    __world.scene.hearingLog.lines
      .filter((line) => line.kind === "chat")
      .map((line) => `${line.speaker}: ${line.text}`));
/** The lines Ulgar spoke, which name the player they answer. */
const ulgarLines = async (page: Page) =>
  (await heard(page)).filter((line) => line.startsWith("Ulgar: "));
/** Whether Ulgar shows its thought icon. */
const ulgarThinking = (page: Page) =>
  readWorld(
    page,
    (__world) => __world.scene.world.players["npc-ulgar"].typing === true,
  );
/** Whether the player with this id shows the thought icon on the host's world. */
const thinking = (host: Page, id: string) =>
  readWorld(
    host,
    (__world, id) => __world.scene.world.players[id]?.typing === true,
    id,
  );
/** Open the conversation by aiming at Ulgar from the tile the player stands on. */
async function talkToUlgar(page: Page, aim: string[]) {
  // A hidden tab draws no frames, so the menu would not see the key release.
  await page.bringToFront();
  for (const key of aim) await page.keyboard.down(key);
  await page.keyboard.press("Space");
  for (const key of aim) await page.keyboard.up(key);
  await expect.poll(() => shopOpen(page)).toBe(true);
}
/** Choose "What do you buy?" and confirm it. */
async function askWhatYouBuy(page: Page) {
  await page.bringToFront();
  await waitFrames(page, 2);
  await page.keyboard.press("k");
  await page.keyboard.press("Space");
}
async function join(browser: import("@playwright/test").Browser) {
  const host = await browser.newPage();
  await openWorld(host, "/?harness=1&layout=room");
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  const join = async () => {
    const page = await browser.newPage();
    await openWorld(page, `/join/${session}?harness=1&layout=room`);
    await ready(page);
    await expect.poll(() => localId(page)).toMatch(/^peer-/);
    return page;
  };
  return { host, join };
}
test("two players ask what Ulgar buys, and Ulgar answers each in order by name", async ({ browser }) => {
  const { host, join: joinGuest } = await join(browser);
  const guest = await joinGuest();
  const watcher = await joinGuest();
  try {
    const guestId = await localId(guest);
    await say(host, "/nick Hana");
    await say(guest, "/nick Gus");
    await placePlayer(host, 16, 13, 4);
    await placePlayer(host, 17, 13, 4, guestId);
    await placePlayer(host, 16, 16, 4, await localId(watcher));
    await waitFrames(host, 3);
    await waitFrames(guest, 3);
    await talkToUlgar(host, ["i"]);
    await talkToUlgar(guest, ["i", "j"]);
    // Choices are private and the thought icon shows while a menu is open.
    await expect.poll(() => thinking(host, "self")).toBe(true);
    await expect.poll(() => thinking(host, guestId)).toBe(true);
    expect((await heard(watcher)).filter((line) => line.includes(ASK)))
      .toEqual([]);
    await evidenceShot(host, "trader-conversation-host");
    await evidenceShot(guest, "trader-conversation-guest");
    await askWhatYouBuy(host);
    await expect.poll(() => heard(watcher)).toContain(`Hana: ${ASK}`);
    await askWhatYouBuy(guest);
    await expect.poll(() => heard(watcher)).toContain(`Gus: ${ASK}`);
    // Ulgar thinks, then answers Hana first and Gus second, one at a time.
    await waitFor(host, () => ulgarThinking(host), {
      message: "Ulgar thinking",
    });
    await evidenceShot(watcher, "trader-ulgar-thinking");
    await waitFor(
      watcher,
      async () => (await ulgarLines(watcher)).length === 2,
      {
        maxTicks: 600,
        message: "Ulgar replies",
      },
    );
    const [first, second] = await ulgarLines(watcher);
    expect(first).toMatch(/^Ulgar: Hana, /);
    expect(second).toMatch(/^Ulgar: Gus, /);
    await evidenceShot(watcher, "trader-ulgar-replied");
    // Both exchanges reach the nearby third player in order.
    const chat = (await heard(watcher)).map((line) => line.split(": ")[0]);
    expect(chat).toEqual(["Hana", "Gus", "Ulgar", "Ulgar"]);
    // The menus stay open and the thought icons stay up until the players leave.
    expect(await shopOpen(host)).toBe(true);
    await host.keyboard.press("Escape");
    await expect.poll(() => thinking(host, "self")).toBe(false);
  } finally {
    await Promise.all([host.close(), guest.close(), watcher.close()]);
  }
});
test("walking out of range closes the menu, and the pending reply still arrives", async ({ browser }) => {
  const { host, join: joinGuest } = await join(browser);
  const watcher = await joinGuest();
  try {
    await say(host, "/nick Hana");
    await placePlayer(host, 16, 13, 4);
    await placePlayer(host, 15, 15, 4, await localId(watcher));
    await waitFrames(host, 3);
    await talkToUlgar(host, ["i"]);
    await askWhatYouBuy(host);
    await expect.poll(() => heard(watcher)).toContain(`Hana: ${ASK}`);
    // Out of range: the menu closes and the thought icon goes with it.
    await placePlayer(host, 16, 16, 4);
    await expect.poll(() => shopOpen(host)).toBe(false);
    await expect.poll(() => thinking(host, "self")).toBe(false);
    // The reply that was being prepared finishes normally.
    await waitFor(
      watcher,
      async () => (await ulgarLines(watcher)).length === 1,
      {
        maxTicks: 600,
        message: "Ulgar replies",
      },
    );
    expect((await ulgarLines(watcher))[0]).toMatch(/^Ulgar: Hana, /);
  } finally {
    await Promise.all([host.close(), watcher.close()]);
  }
});
test("a conversation with Ulgar shows both thought icons and a reply that names the player", async ({ page }) => {
  await openWorld(page, "/?harness=1&layout=room");
  await ready(page);
  await say(page, "/nick Hana");
  await placePlayer(page, 16, 13, 4);
  await waitFrames(page, 3);
  await talkToUlgar(page, ["i"]);
  await expect.poll(() => thinking(page, "self")).toBe(true);
  await evidenceShot(page, "trader-conversation-menu");
  // Highlighting is silent: nothing is spoken until the choice is confirmed.
  await page.keyboard.press("k");
  await waitTicks(page, 10);
  expect(await heard(page)).toEqual([]);
  await page.keyboard.press("Space");
  await expect.poll(() => heard(page)).toEqual([`Hana: ${ASK}`]);
  // Ulgar thinks while the player browses, then answers by name.
  await waitFor(page, () => ulgarThinking(page), { message: "Ulgar thinking" });
  expect(await thinking(page, "self")).toBe(true);
  await waitFor(page, async () => (await ulgarLines(page)).length === 1, {
    maxTicks: 600,
    message: "Ulgar replies",
  });
  expect((await ulgarLines(page))[0]).toMatch(/^Ulgar: Hana, /);
  await evidenceShot(page, "trader-conversation-reply");
  // A second question works once Ulgar has answered the first.
  await page.keyboard.press("Space");
  await expect.poll(async () => (await heard(page)).length).toBe(3);
});
