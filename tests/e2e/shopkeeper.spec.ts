import { giveItems as give } from "./world.ts";
import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { holdUntil, waitFor, waitFrames, waitTicks } from "./time.ts";
import { ready, shopOpen, shopRow, tapUi, uiRect } from "./ui.ts";
// Ulgar, the shopkeeper NPC, stands at (16, 12) on level 4, in the spawn room.
const SHOP = { x: 16, y: 12, z: 4 };
const position = (page: Page) =>
  readWorld(page, (__world) => {
    const scene = __world.scene;
    return scene.world.players[scene.localId];
  });
const inventory = (page: Page) =>
  readWorld(page, (__world) => __world.scene.inventory);
const coins = async (page: Page) =>
  (await inventory(page)).find((stack) => stack.kind === "coin")?.count ?? 0;
const systemLines = (page: Page) =>
  readWorld(page, (__world) =>
    __world.scene.hearingLog.lines
      .filter((line) => line.kind === "system").map((line) => line.text));
const notice = (page: Page) =>
  readWorld(page, (__world) => __world.scene.notice?.text ?? "");
/** Wait until Ulgar has answered `count` requests this page heard: a sale is a request, so the next one waits for the answer. */
const answered = (page: Page, count: number) =>
  waitFor(
    page,
    async () =>
      (await readWorld(page, (__world) =>
        __world.scene.hearingLog.lines.filter((line) =>
          line.kind === "chat" && line.speaker === "Ulgar"
        ).length)) >= count,
    { maxTicks: 600, message: `Ulgar answered ${count}` },
  );
/** Stand the host's player still on a tile. */
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
async function startHost(page: Page, query = "") {
  await openWorld(page, `/?harness=1&layout=room${query}`);
  await ready(page);
}
/** Wait until the local player stands still on a tile center. */
const settle = (page: Page) =>
  expect.poll(async () => (await position(page))?.move ?? null).toBeNull();
/** Hold a key until the local player satisfies the condition, then let the walk settle. */
async function walkUntil(
  page: Page,
  key: string,
  done: (p: {
    x: number;
    y: number;
    z: number;
  }) => boolean,
) {
  await holdUntil(page, key, async () => {
    const p = await position(page);
    return p !== null && done(p);
  });
  await settle(page);
}
/** The material on a tile of the host's world. */
const tileAt = (page: Page, x: number, y: number, z: number) =>
  readWorld(
    page,
    (__world, [tx, ty, tz]) =>
      __world.scene.world.chunks.get(
        `${Math.floor(tx / 16)},${Math.floor(ty / 16)}`,
      )?.[tz * 256 + (ty % 16) * 16 + (tx % 16)] ?? -1,
    [x, y, z],
  );
/** Confirm "I have ore to trade", which opens the item list inside the conversation. */
async function openItems(page: Page) {
  await page.keyboard.press("Space");
  await expect.poll(() => shopRow(page, "all")).not.toBeNull();
}
/** With the aim held, interact. Interact reads the held aim keys at once. */
async function interactAiming(page: Page, ...keys: string[]) {
  for (const key of keys) {
    await page.keyboard.down(key);
  }
  await page.keyboard.press("Space");
  for (const key of keys) {
    await page.keyboard.up(key);
  }
}
/** The IJKL keys that aim from the player's tile at the shopkeeper's tile. */
async function aimAtShopkeeper(page: Page) {
  const at = (await position(page))!;
  const dx = SHOP.x - Math.round(at.x);
  const dy = SHOP.y - Math.round(at.y);
  return [
    ...(dx < 0 ? ["j"] : dx > 0 ? ["l"] : []),
    ...(dy < 0 ? ["i"] : dy > 0 ? ["k"] : []),
  ];
}
/** Start mining and keep the aim held until the tile is open, because a new aim cancels. */
async function mineAiming(page: Page, key: string, tile: {
  x: number;
  y: number;
  z: number;
}) {
  await page.keyboard.down(key);
  try {
    await page.keyboard.press("Space");
    await expect.poll(() => tileAt(page, tile.x, tile.y, tile.z)).toBe(1);
  } finally {
    await page.keyboard.up(key);
  }
}
test("the host mines ore, sells it to the shopkeeper, and gets coins", async ({ page }) => {
  await startHost(page);
  await expect.poll(() => coins(page)).toBe(0);
  // Down the stairs into the tunnel, then mine coal and iron ore.
  // Ulgar blocks the way north on its own column, so the route bends east first.
  await walkUntil(page, "e", (p) => p.y <= 13.2);
  await walkUntil(page, "f", (p) => p.x >= 17.8);
  await walkUntil(page, "e", (p) => p.y <= 12.1);
  await walkUntil(page, "f", (p) => p.z === 2 && p.x >= 21.2);
  await placeAt(page, 22, 12); // the coal is one tile north of tile 22
  await waitFrames(page, 2);
  await mineAiming(page, "i", { x: 22, y: 11, z: 2 }); // coal
  await interactAiming(page, "i"); // pick the coal up
  await expect.poll(async () => (await inventory(page)).length).toBe(2);
  await placeAt(page, 25, 12); // the iron ore is one tile north of tile 25
  await waitFrames(page, 2);
  await mineAiming(page, "i", { x: 25, y: 11, z: 2 }); // iron ore
  await interactAiming(page, "i"); // pick the iron ore up
  await expect.poll(async () => (await inventory(page)).length).toBe(3);
  expect(await coins(page)).toBe(0);
  // Back up the stairs to the shopkeeper, who stands on the north wall.
  await walkUntil(page, "s", (p) => p.z === 4 && p.x <= 17.2);
  await interactAiming(page, ...(await aimAtShopkeeper(page)));
  await expect.poll(() => shopOpen(page)).toBe(true);
  await openItems(page);
  expect((await shopRow(page, "all"))?.text).toBe("Sell all ore");
  expect((await shopRow(page, "all"))?.price).toBe("4 coins");
  await expect.poll(async () => (await shopRow(page, "pickaxe"))?.dim).toBe(
    true,
  );
  expect((await shopRow(page, "iron ore"))?.text).toBe("Sell all iron ore");
  expect((await shopRow(page, "iron ore"))?.price).toBe("3 coins");
  await evidenceShot(page, "shop-open");
  // IJKL choose a row and interact sells it.
  await page.keyboard.press("k");
  await expect.poll(async () => (await shopRow(page, "all"))?.selected).toBe(
    false,
  );
  await expect.poll(async () => (await shopRow(page, "coal"))?.selected).toBe(
    true,
  );
  await page.keyboard.press("k");
  await expect.poll(async () => (await shopRow(page, "iron ore"))?.selected)
    .toBe(true);
  await page.keyboard.press("Space");
  await expect.poll(() => coins(page)).toBe(3);
  await expect.poll(() => coins(page)).toBe(3);
  expect(await systemLines(page)).toContain("Sold iron ore ×1 for 3 coins");
  await answered(page, 1);
  await evidenceShot(page, "shop-sold-iron");
  // The sell all row takes the rest, and the coins follow.
  // The sold row is gone, so the selection falls back to the first row.
  await expect.poll(async () => (await shopRow(page, "all"))?.selected).toBe(
    true,
  );
  await page.keyboard.press("Space");
  await expect.poll(() => coins(page)).toBe(4);
  await expect.poll(() => coins(page)).toBe(4);
  expect(await systemLines(page)).toContain("Sold coal ×1 for 1 coin");
  await answered(page, 2);
  await evidenceShot(page, "shop-score");
  // Escape goes back to the conversation, and a second one closes the panel.
  await page.keyboard.press("Escape");
  await expect.poll(() => shopRow(page, "all")).toBeNull();
  expect(await shopOpen(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => shopOpen(page)).toBe(false);
  expect(await inventory(page)).toEqual([
    { kind: "pickaxe", count: 1 },
    { kind: "coin", count: 4 },
  ]);
});
test("a guest sells through the host, and the host rejects what it does not hold", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await startHost(host);
    const session = await readWorld(host, (__world) => __world.scene.sessionId);
    await openWorld(guest, `/join/${session}?harness=1&layout=room`);
    await ready(guest);
    await expect.poll(async () => (await position(guest))?.z).toBe(4);
    const id = await readWorld(guest, (__world) => __world.scene.localId);
    await give(host, "coal", 3, id);
    await give(host, "stone", 2, id);
    await expect.poll(async () => (await inventory(guest)).length).toBe(3);
    // Far from the shopkeeper the host refuses.
    await readWorld(guest, (__world) =>
      __world.send({
        type: "sell",
        kind: "coal",
        count: 1,
      }));
    await expect.poll(() => notice(guest)).toContain("too far");
    // Walk up to Ulgar: the way north on its column is blocked.
    await walkUntil(guest, "e", (p) => p.y <= 13.2);
    await walkUntil(guest, "f", (p) => p.x >= 15.8);
    await guest.keyboard.down("e");
    await waitTicks(guest, 20);
    await guest.keyboard.up("e");
    await settle(guest);
    expect((await position(guest))!.y).toBeGreaterThan(SHOP.y + 0.5);
    // A request for more than it holds, or for stone, changes nothing.
    for (
      const message of [
        { type: "sell", kind: "coal", count: 4 },
        { type: "sell", kind: "diamond", count: 1 },
        { type: "sell", kind: "stone", count: 1 },
      ]
    ) {
      await readWorld(guest, (__world, m) => __world.send(m), message);
    }
    await expect.poll(() => notice(guest)).toContain("Cannot sell");
    // Give any coins time to arrive, to prove none do.
    await waitTicks(guest, 8);
    expect(await coins(guest)).toBe(0);
    expect(await inventory(guest)).toContainEqual({ kind: "coal", count: 3 });
    // Aim at the shopkeeper from wherever the guest stands.
    await interactAiming(guest, ...(await aimAtShopkeeper(guest)));
    await expect.poll(() => shopOpen(guest)).toBe(true);
    await openItems(guest);
    await expect.poll(async () => (await shopRow(guest, "stone"))?.dim).toBe(
      true,
    );
    await guest.keyboard.press("k"); // sell all -> first ore row
    await guest.keyboard.press("Space");
    await expect.poll(() => coins(guest)).toBe(3);
    await expect.poll(() => coins(guest)).toBe(3);
    expect(await systemLines(guest)).toContain("Sold coal ×3 for 3 coins");
    // The sale line belongs to the seller alone.
    expect(await systemLines(host)).not.toContain("Sold coal ×3 for 3 coins");
    await evidenceShot(guest, "shop-guest");
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});
test("the shop works by touch on a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const phone = await context.newPage();
  try {
    await startHost(phone);
    await give(phone, "gold ore", 2);
    await give(phone, "lapis", 1);
    await give(phone, "stone", 5);
    // From the tile south of Ulgar, with the aim held north, interact opens the shop.
    await placeAt(phone, SHOP.x, SHOP.y + 1);
    await waitFrames(phone, 2);
    await phone.keyboard.down("i");
    await tapUi(phone, "btn:interact");
    await phone.keyboard.up("i");
    await expect.poll(() => shopOpen(phone)).toBe(true);
    await tapUi(phone, "row:talk:sell");
    await expect.poll(async () => (await shopRow(phone, "stone"))?.dim).toBe(
      true,
    );
    const panel = await uiRect(phone, "panel:shop");
    const stick = await uiRect(phone, "stick:move");
    expect(panel.y + panel.h).toBeLessThan(stick.y);
    await evidenceShot(phone, "shop-phone");
    // A tap on a dimmed row sells nothing; a tap on a stack sells it.
    await tapUi(phone, "row:stone");
    expect(await coins(phone)).toBe(0);
    await tapUi(phone, "row:gold ore");
    await expect.poll(() => coins(phone)).toBe(16);
    await expect.poll(() => coins(phone)).toBe(16);
    await answered(phone, 1);
    await tapUi(phone, "btn:interact"); // sells the selected row
    await expect.poll(() => coins(phone)).toBe(20);
    await evidenceShot(phone, "shop-phone-sold");
    await tapUi(phone, "btn:shop-close");
    await expect.poll(() => shopOpen(phone)).toBe(false);
  } finally {
    await context.close();
  }
});
test("a gamepad moves the selection and sells", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
      connected: true,
      id: "Test Switch controller",
      index: 0,
      mapping: "standard",
    };
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad] });
    (globalThis as unknown as {
      __pad: typeof pad;
    }).__pad = pad;
  });
  await startHost(page, "&gamepad-debug=1");
  await give(page, "coal", 2);
  await give(page, "diamond", 1);
  await placeAt(page, SHOP.x, SHOP.y + 1);
  await waitFrames(page, 2);
  // The frame loop reads the pad once per frame, and a held D-pad repeats after
  // a wall-clock delay. So the button is down for exactly one game frame: the
  // game's frame callback runs before the one that lets go, which was queued
  // after it.
  const press = (button: number) =>
    page.evaluate((b) =>
      new Promise<void>((resolve) => {
        const pad = (globalThis as unknown as {
          __pad: {
            buttons: {
              pressed: boolean;
            }[];
          };
        }).__pad;
        pad.buttons[b].pressed = true;
        requestAnimationFrame(() => {
          pad.buttons[b].pressed = false;
          requestAnimationFrame(() => resolve());
        });
      }), button);
  // The look stick aims north at Ulgar while ZR interacts.
  await page.evaluate(() => {
    (globalThis as unknown as { __pad: { axes: number[] } }).__pad.axes[3] = -1;
  });
  await press(7); // ZR interact opens the shop
  await page.evaluate(() => {
    (globalThis as unknown as { __pad: { axes: number[] } }).__pad.axes[3] = 0;
  });
  await expect.poll(() => shopOpen(page)).toBe(true);
  await press(7); // ZR says "I have ore to trade" and opens the item list
  await expect.poll(async () => (await shopRow(page, "all"))?.selected).toBe(
    true,
  );
  await press(13); // D-pad down
  await expect.poll(async () => (await shopRow(page, "coal"))?.selected).toBe(
    true,
  );
  // The look stick moves the selection too.
  await page.evaluate(() => {
    (globalThis as unknown as {
      __pad: {
        axes: number[];
      };
    }).__pad.axes[3] = 1;
  });
  await expect.poll(async () => (await shopRow(page, "diamond"))?.selected)
    .toBe(true);
  await page.evaluate(() => {
    (globalThis as unknown as {
      __pad: {
        axes: number[];
      };
    }).__pad.axes[3] = 0;
  });
  await press(7); // ZR sells the diamond
  await expect.poll(() => coins(page)).toBe(20);
  await press(3); // X closes
  await expect.poll(() => shopOpen(page)).toBe(false);
});
test("Ulgar stands in the spawn room as a named NPC with a gold tint", async ({ page }) => {
  await startHost(page);
  await placeAt(page, SHOP.x, SHOP.y + 3);
  await waitFrames(page, 3);
  const ulgar = await readWorld(
    page,
    (__world) => __world.scene.world.players["npc-ulgar"],
  );
  expect(ulgar).toMatchObject({
    name: "Ulgar",
    npc: true,
    role: "trader",
    x: SHOP.x,
    y: SHOP.y,
    z: SHOP.z,
  });
  await evidenceShot(page, "ulgar-spawn-room");
});
