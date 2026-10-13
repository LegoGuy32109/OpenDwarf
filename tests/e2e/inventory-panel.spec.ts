import { giveItems } from "./world.ts";
import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { holdUntil, waitFrames, waitTicks } from "./time.ts";
import {
  clickUi,
  hasUi,
  heldSlot,
  ready,
  selectedSlot,
  slots,
  tapUi,
  uiRect,
} from "./ui.ts";
const OPEN = 1;
const od = (page: Page) => readWorld(page, (__world) => __world.scene.localId);
const tile = (page: Page, x: number, y = 1) =>
  readWorld(
    page,
    (__world, [tx, ty]) =>
      __world.scene.world.chunks.get("0,0")?.[ty * 16 + tx] ?? -1,
    [x, y],
  );
const notice = (page: Page) =>
  readWorld(page, (__world) => __world.scene.notice?.text ?? "");
/** The host's own held item. */
const held = (page: Page) =>
  readWorld(page, (__world) => {
    const scene = __world.scene;
    return scene.world.players[scene.localId].held ?? "pickaxe";
  });
const placeAt = (page: Page, x: number, y: number) =>
  readWorld(page, (__world, [px, py]) => {
    const scene = __world.scene;
    const player = scene.world.players[scene.localId];
    __world.edit({
      players: [{
        id: player.id,
        at: {
          x: px,
          y: py,
          z: player.z,
        },
      }],
    });
  }, [x, y]);
async function startHost(page: Page) {
  await openWorld(page, "/?harness=1");
  await ready(page);
}
/**
 * Hold a look key until the selection reaches `kind`, then let go. A fixed hold
 * time misses the step when no frame runs during it, or steps twice when one
 * long frame passes the panel's 180 ms key repeat; slow polling misses it too.
 */
async function step(page: Page, key: string, kind: string) {
  await page.keyboard.down(key);
  // Poll faster than the 180 ms repeat, or a held key runs past `kind`.
  await expect.poll(() => selectedSlot(page), { intervals: [20] }).toBe(kind);
  await page.keyboard.up(key);
  await expect.poll(() => selectedSlot(page)).toBe(kind);
}
test("B opens the panel, IJKL moves the selection, and interact holds an item", async ({ page }) => {
  await startHost(page);
  const me = await od(page);
  await give(page, me, "coal", 12);
  await give(page, me, "diamond", 3);
  await give(page, me, "gold ore", 2);
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(false);
  // Closed, the panel does not block walking.
  const yOf = () =>
    readWorld(page, (__world, id) => __world.scene.world.players[id].y, me);
  const startY = await yOf();
  await holdUntil(page, "e", async () => await yOf() < startY);
  await placeAt(page, 2, 2);
  await page.keyboard.press("b");
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(true);
  expect(await slots(page)).toHaveLength(4);
  expect(await hasUi(page, "icon:held")).toBe(true);
  // Others see the typing bubble while the panel is open.
  await expect.poll(() =>
    readWorld(
      page,
      (__world, id) => __world.scene.world.players[id].typing,
      me,
    )
  ).toBe(true);
  await evidenceShot(page, "inventory-desktop");
  // The selection starts on the held pickaxe; L steps right, J back.
  await expect.poll(() => selectedSlot(page)).toBe("pickaxe");
  await step(page, "l", "coal");
  await step(page, "l", "diamond");
  await step(page, "l", "gold ore");
  await step(page, "j", "diamond");
  await page.keyboard.press("Space"); // interact holds diamond
  await expect.poll(() => held(page)).toBe("diamond");
  await expect.poll(() => heldSlot(page)).toBe("diamond");
  await evidenceShot(page, "inventory-diamond-held");
  await page.keyboard.press("b");
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(false);
  await expect.poll(() =>
    readWorld(
      page,
      (__world, id) => __world.scene.world.players[id].typing,
      me,
    )
  ).toBe(false);
  // A held diamond prevents mining. Aim north at the stone and interact.
  await page.keyboard.down("i");
  await page.keyboard.press("Space");
  await expect.poll(() => notice(page)).toContain("no pickaxe");
  expect(await tile(page, 2)).not.toBe(OPEN);
  await page.keyboard.up("i");
  // Switch back to the pickaxe: Escape closes the panel, not the menu.
  await page.keyboard.press("b");
  await page.keyboard.press("Escape");
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(false);
  await page.keyboard.press("b");
  await page.keyboard.down("k");
  await waitFrames(page, 3);
  await page.keyboard.up("k"); // already on row 0: stays
  await clickUi(page, "slot:pickaxe"); // a tap holds it
  await expect.poll(() => held(page)).toBe("pickaxe");
  await page.keyboard.press("b");
  await page.keyboard.down("i");
  await page.keyboard.press("Space");
  await expect.poll(() => tile(page, 2)).toBe(OPEN);
  await page.keyboard.up("i");
});
test("a joining player holds an item through the host and others see its bubble", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await startHost(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() => od(guest)).toMatch(/^peer-/);
  const guestId = await od(guest);
  await give(host, guestId, "iron ore", 5);
  await expect.poll(() =>
    readWorld(guest, (__world) => __world.scene.inventory.length)
  ).toBe(2);
  const hostSeesTyping = () =>
    readWorld(
      host,
      (__world, id) => __world.scene.world.players[id].typing,
      guestId,
    );
  await guest.keyboard.press("b");
  await expect.poll(() => hasUi(guest, "panel:bag")).toBe(true);
  await expect.poll(hostSeesTyping).toBe(true);
  await expect.poll(() =>
    readWorld(
      host,
      (__world) =>
        __world.scene.chatFeed.filter((record) => record.typing).length,
    )
  ).toBe(1);
  await step(guest, "l", "iron ore");
  await guest.keyboard.press("Space");
  await expect.poll(() => readWorld(guest, (__world) => __world.scene.heldFeed))
    .toBe("iron ore");
  await expect.poll(() =>
    readWorld(
      host,
      (__world, id) => __world.scene.world.players[id].held,
      guestId,
    )
  ).toBe("iron ore");
  // The host refuses an item the guest does not carry.
  await readWorld(
    guest,
    (__world) => __world.send({ type: "hold", kind: "diamond" }),
  );
  await waitTicks(host, 10);
  expect(
    await readWorld(
      host,
      (__world, id) => __world.scene.world.players[id].held,
      guestId,
    ),
  ).toBe("iron ore");
  await guest.keyboard.press("b");
  await expect.poll(() => hasUi(guest, "panel:bag")).toBe(false);
  await expect.poll(hostSeesTyping).toBe(false);
  await Promise.all([host.close(), guest.close()]);
});
test("the bag button opens the panel on a phone and a tap holds an item", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await startHost(page);
  const me = await od(page);
  await give(page, me, "coal", 12);
  await give(page, me, "diamond", 3);
  await uiRect(page, "btn:bag");
  await evidenceShot(page, "inventory-phone-closed");
  await tapUi(page, "btn:bag");
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(true);
  await evidenceShot(page, "inventory-phone");
  await tapUi(page, "slot:diamond");
  await expect.poll(() => held(page)).toBe("diamond");
  await evidenceShot(page, "inventory-phone-held");
  await tapUi(page, "btn:bag-close");
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(false);
  // The interact button drives the panel while it is open, then mines again.
  await tapUi(page, "btn:bag");
  await tapUi(page, "slot:pickaxe");
  await expect.poll(() => held(page)).toBe("pickaxe");
  await context.close();
});
const give = (page: Page, id: string, kind: string, count: number) =>
  giveItems(page, kind, count, id);
