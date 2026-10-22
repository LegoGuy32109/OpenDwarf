import { giveItems, openWorld, placePlayer, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { waitFor, waitFrames } from "./time.ts";
import { ready, say, shopOpen, shopRow } from "./ui.ts";
import { SALE_REPLIES } from "../../src/shared/npc-conversation.js";
import { MAX_STACK_COUNT } from "../../src/shared/items.js";

const localId = (page: Page) =>
  readWorld(page, (__world) => __world.scene.localId);
const stack = (page: Page, kind: string) =>
  readWorld(
    page,
    (__world, kind) =>
      __world.scene.inventory.find((item) => item.kind === kind)?.count ?? 0,
    kind,
  );
const systemLines = (page: Page) =>
  readWorld(page, (__world) =>
    __world.scene.hearingLog.lines
      .filter((line) => line.kind === "system").map((line) => line.text));
const notice = (page: Page) =>
  readWorld(page, (__world) => __world.scene.notice?.text ?? "");
/** The chat lines a page heard, as "speaker: text". */
const heard = (page: Page) =>
  readWorld(page, (__world) =>
    __world.scene.hearingLog.lines
      .filter((line) => line.kind === "chat")
      .map((line) => `${line.speaker}: ${line.text}`));
/** The lines Ulgar spoke to Gus. */
const ulgarLines = async (page: Page) =>
  (await heard(page)).filter((line) => line.startsWith("Ulgar: Gus, "));
/** Wait for Ulgar's `count`th answer to Gus, and return it. A sale is a request, so the next one waits for it. */
async function answered(page: Page, count: number) {
  await waitFor(page, async () => (await ulgarLines(page)).length >= count, {
    maxTicks: 600,
    message: `Ulgar answered ${count}`,
  });
  return (await ulgarLines(page))[count - 1];
}
/** Every line a set of authored replies can speak to Gus for these numbers. */
const lines = (
  outcome: keyof typeof SALE_REPLIES,
  facts: { name: string; count: number; coins: number },
) => SALE_REPLIES[outcome].map((line) => `Ulgar: Gus, ${line(facts)}`);
/** Ask Ulgar for a sale without the menu, as a modified client could. */
const sendSale = (page: Page, sale: Record<string, unknown>) =>
  readWorld(
    page,
    (__world, sale) =>
      __world.send({ type: "talk", npc: "npc-ulgar", choice: "sale", sale }),
    sale,
  );

test("a guest sells one kind and then all ore by speaking, and Ulgar's reply matches the result", async ({ browser, page: guest }) => {
  const host = await browser.newPage();
  try {
    await openWorld(host, "/?harness=1&layout=room");
    await ready(host);
    const session = await readWorld(host, (__world) => __world.scene.sessionId);
    await openWorld(guest, `/join/${session}?harness=1&layout=room`);
    await ready(guest);
    await expect.poll(() => localId(guest)).toMatch(/^peer-/);
    const guestId = await localId(guest);
    await say(guest, "/nick Gus");
    await placePlayer(host, 15, 14, 4);
    await placePlayer(host, 17, 12, 4, guestId);
    await giveItems(host, "coal", 3, guestId);
    await giveItems(host, "lapis", 2, guestId);
    await giveItems(host, "stone", 4, guestId);
    await expect.poll(() => stack(guest, "lapis")).toBe(2);
    await waitFrames(guest, 3);
    await guest.bringToFront();
    await guest.keyboard.down("j");
    await guest.keyboard.press("Space");
    await guest.keyboard.up("j");
    await expect.poll(() => shopOpen(guest)).toBe(true);
    // "I have ore to trade" opens the item list.
    await waitFrames(guest, 2);
    await guest.keyboard.press("Space");
    await expect.poll(() => shopRow(guest, "all")).not.toBeNull();
    expect(await shopRow(guest, "coal")).toMatchObject({
      text: "Sell all coal",
      count: "x3",
      price: "3 coins",
    });
    expect(await shopRow(guest, "all")).toMatchObject({
      text: "Sell all ore",
      count: "x5",
      price: "11 coins",
    });
    await evidenceShot(guest, "spoken-sale-list");

    // Sell one kind: the host accepts at once, then Ulgar answers.
    await guest.keyboard.press("k");
    await expect.poll(async () => (await shopRow(guest, "coal"))?.selected)
      .toBe(true);
    await guest.keyboard.press("Space");
    await expect.poll(() => stack(guest, "coin")).toBe(3);
    expect(await stack(guest, "coal")).toBe(0);
    expect(await systemLines(guest)).toContain("Sold coal ×3 for 3 coins");
    // A second sale waits for the answer: it is refused and changes nothing.
    await guest.keyboard.press("Space");
    await expect.poll(() => notice(guest)).toContain(
      "still owes you an answer",
    );
    expect(await stack(guest, "lapis")).toBe(2);
    // The request is spoken in turn, after the line that opened the list.
    await expect.poll(() => heard(guest)).toContain("Gus: Sell all coal");
    await evidenceShot(guest, "spoken-sale-asked");
    expect(lines("kind", { name: "coal", count: 3, coins: 3 })).toContain(
      await answered(guest, 1),
    );
    await evidenceShot(guest, "spoken-sale-answered");

    // Sell all ore: the lapis goes, the stone stays.
    await guest.keyboard.press("Space");
    await expect.poll(() => stack(guest, "coin")).toBe(11);
    expect(await stack(guest, "stone")).toBe(4);
    expect(await systemLines(guest)).toContain("Sold lapis ×2 for 8 coins");
    expect(lines("all", { name: "ore", count: 2, coins: 8 })).toContain(
      await answered(guest, 2),
    );
    // The host never saw the guest's private sale lines.
    expect(await systemLines(host)).not.toContain("Sold coal ×3 for 3 coins");

    // Nothing left to sell: the request is spoken and answered, nothing changes.
    expect(await sendSale(guest, { all: true })).toBe(true);
    expect(lines("nothing", { name: "ore", count: 0, coins: 0 })).toContain(
      await answered(guest, 3),
    );
    expect(await stack(guest, "coin")).toBe(11);

    // A full coin stack refuses the sale, keeps the ore, and Ulgar says so.
    await giveItems(host, "coin", MAX_STACK_COUNT - 11 - 1, guestId);
    await giveItems(host, "diamond", 1, guestId);
    await expect.poll(() => stack(guest, "diamond")).toBe(1);
    const before = await stack(guest, "coin");
    expect(await sendSale(guest, { kind: "diamond" })).toBe(true);
    // Moving away does not cancel a confirmed sale: the reply still arrives.
    await expect.poll(() => heard(guest)).toContain("Gus: Sell all diamond");
    await placePlayer(host, 17, 15, 4, guestId);
    await expect.poll(() => shopOpen(guest)).toBe(false);
    expect(lines("full", { name: "diamond", count: 1, coins: 20 })).toContain(
      await answered(guest, 4),
    );
    expect(await stack(guest, "diamond")).toBe(1);
    expect(await stack(guest, "coin")).toBe(before);
    expect(await systemLines(guest)).not.toContain(
      "Sold diamond ×1 for 20 coins",
    );
  } finally {
    await host.close();
  }
});
