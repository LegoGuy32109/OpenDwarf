import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready, shopOpen, shopRow, tapUi, uiRect } from "./ui.ts";

type Stack = { kind: string; count: number };
type Harness = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      notice?: { text: string };
      inventory: Stack[];
      hearingLog: { lines: { kind: string; text: string }[] };
      world: {
        chunks: Map<string, Uint8Array>;
        players: Record<string, { x: number; y: number; z: number }>;
      };
    };
    send: (message: Record<string, unknown>) => boolean;
  };
};

// The shopkeeper stands at (16, 12) on level 4, in the spawn room.
const SHOP = { x: 16, y: 12, z: 4 };

const position = (page: Page) =>
  page.evaluate(() => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    return scene.world.players[scene.localId];
  });

const inventory = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.inventory);

const coins = async (page: Page) =>
  (await inventory(page)).find((stack) => stack.kind === "coin")?.count ?? 0;

const systemLines = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.hearingLog.lines
      .filter((line) => line.kind === "system").map((line) => line.text)
  );

const notice = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.notice?.text ?? ""
  );

/** Give a player items in the host's world. `id` defaults to the host's own player. */
const give = (page: Page, kind: string, count: number, id?: string) =>
  page.evaluate(async ([k, n, who]) => {
    const items = await import("/src/shared/items.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[who ?? scene.localId];
    items.addStack(
      items.inventoryOf(player as never),
      k as string,
      n as number,
    );
  }, [kind, count, id ?? null] as const);

/** Stand the host's player still on a tile. */
const placeAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[scene.localId] as Record<string, number>;
    Object.assign(player, { x: px, y: py, previousX: px, previousY: py });
  }, [x, y]);

async function startHost(page: Page, query = "") {
  await page.goto(`/?harness=1&layout=room${query}`);
  await ready(page);
}

/** Hold a key until the local player satisfies the condition. */
async function holdUntil(
  page: Page,
  key: string,
  done: (p: { x: number; y: number; z: number }) => boolean,
) {
  await page.keyboard.down(key);
  await expect.poll(async () => {
    const p = await position(page);
    return p !== null && done(p);
  }, { timeout: 20_000 }).toBe(true);
  await page.keyboard.up(key);
  await page.waitForTimeout(250);
}

/** With the aim held, interact, and wait for the host to answer. */
async function interactAiming(page: Page, ...keys: string[]) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  for (const key of keys) await page.keyboard.up(key);
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

/** Start mining and keep the aim held until the tile is gone, because a new aim cancels. */
async function mineAiming(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(300);
}

test("the host mines ore, sells it to the shopkeeper, and gets coins", async ({ page }) => {
  test.setTimeout(120_000);
  await startHost(page);
  await expect.poll(() => coins(page)).toBe(0);
  // Down the stairs into the tunnel, then mine coal and iron ore.
  await holdUntil(page, "e", (p) => p.y <= 12.1);
  await holdUntil(page, "f", (p) => p.z === 2 && p.x >= 21.2);
  await placeAt(page, 22, 12); // the coal is one tile north of tile 22
  await page.waitForTimeout(300);
  await mineAiming(page, "i", 2000); // coal at (22, 11)
  await expect.poll(
    () =>
      page.evaluate(() =>
        (globalThis as unknown as Harness).__od.scene.world.chunks.get("1,0")
          ?.[2 * 256 + 11 * 16 + 6] ?? -1
      ),
    { timeout: 8000 },
  ).toBe(1);
  await page.waitForTimeout(300);
  await interactAiming(page, "i"); // pick the coal up
  await expect.poll(async () => (await inventory(page)).length).toBe(2);
  await placeAt(page, 25, 12); // the iron ore is one tile north of tile 25
  await page.waitForTimeout(300);
  await mineAiming(page, "i", 2500); // iron ore at (25, 11)
  await interactAiming(page, "i"); // pick the iron ore up
  await expect.poll(async () => (await inventory(page)).length).toBe(3);
  expect(await coins(page)).toBe(0);
  // Back up the stairs to the shopkeeper, who stands on the north wall.
  await holdUntil(page, "s", (p) => p.z === 4 && p.x <= 17.2);
  await interactAiming(page, ...(await aimAtShopkeeper(page)));
  await expect.poll(() => shopOpen(page)).toBe(true);
  expect((await shopRow(page, "all"))?.text).toBe("Sell all ore");
  expect((await shopRow(page, "all"))?.price).toBe("4 coins");
  await expect.poll(async () => (await shopRow(page, "pickaxe"))?.dim).toBe(
    true,
  );
  expect((await shopRow(page, "iron ore"))?.price).toBe("3 each");
  await page.waitForTimeout(300);
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
  await page.waitForTimeout(600);
  await evidenceShot(page, "shop-score");
  // Escape closes the panel and the player can walk again.
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
    const session = await host.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1&layout=room`);
    await ready(guest);
    await expect.poll(async () => (await position(guest))?.z).toBe(4);
    const id = await guest.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.localId
    );
    await give(host, "coal", 3, id);
    await give(host, "stone", 2, id);
    await expect.poll(async () => (await inventory(guest)).length).toBe(3);
    // Far from the shopkeeper the host refuses.
    await guest.evaluate(() =>
      (globalThis as unknown as Harness).__od.send({
        type: "sell",
        kind: "coal",
        count: 1,
      })
    );
    await expect.poll(() => notice(guest)).toContain("too far");
    // Walk next to the shopkeeper.
    await guest.keyboard.down("e");
    await expect.poll(async () => (await position(guest))?.y ?? 99, {
      timeout: 20_000,
    }).toBeLessThanOrEqual(13.2);
    await guest.keyboard.up("e");
    await guest.waitForTimeout(400);
    // A request for more than it holds, or for stone, changes nothing.
    for (
      const message of [
        { type: "sell", kind: "coal", count: 4 },
        { type: "sell", kind: "diamond", count: 1 },
        { type: "sell", kind: "stone", count: 1 },
      ]
    ) {
      await guest.evaluate(
        (m) => (globalThis as unknown as Harness).__od.send(m),
        message,
      );
    }
    await expect.poll(() => notice(guest)).toContain("Cannot sell");
    await guest.waitForTimeout(400);
    expect(await coins(guest)).toBe(0);
    expect(await inventory(guest)).toContainEqual({ kind: "coal", count: 3 });
    // Aim at the shopkeeper from wherever the guest stands.
    await interactAiming(guest, ...(await aimAtShopkeeper(guest)));
    await expect.poll(() => shopOpen(guest)).toBe(true);
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
    // Standing on the shopkeeper's tile highlights it with no aim.
    await placeAt(phone, SHOP.x, SHOP.y);
    await tapUi(phone, "btn:interact");
    await expect.poll(() => shopOpen(phone)).toBe(true);
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
    (globalThis as unknown as { __pad: typeof pad }).__pad = pad;
  });
  await startHost(page, "&gamepad-debug=1");
  await give(page, "coal", 2);
  await give(page, "diamond", 1);
  await placeAt(page, SHOP.x, SHOP.y);
  await page.waitForTimeout(400);
  const press = async (button: number) => {
    await page.evaluate((b) => {
      (globalThis as unknown as { __pad: { buttons: { pressed: boolean }[] } })
        .__pad.buttons[b].pressed = true;
    }, button);
    await page.waitForTimeout(300);
    await page.evaluate((b) => {
      (globalThis as unknown as { __pad: { buttons: { pressed: boolean }[] } })
        .__pad.buttons[b].pressed = false;
    }, button);
    await page.waitForTimeout(300);
  };
  await press(0); // interact opens the shop
  await expect.poll(() => shopOpen(page)).toBe(true);
  await expect.poll(async () => (await shopRow(page, "all"))?.selected).toBe(
    true,
  );
  await press(13); // D-pad down
  await expect.poll(async () => (await shopRow(page, "coal"))?.selected).toBe(
    true,
  );
  // The look stick moves the selection too.
  await page.evaluate(() => {
    (globalThis as unknown as { __pad: { axes: number[] } }).__pad.axes[3] = 1;
  });
  await expect.poll(async () => (await shopRow(page, "diamond"))?.selected)
    .toBe(true);
  await page.evaluate(() => {
    (globalThis as unknown as { __pad: { axes: number[] } }).__pad.axes[3] = 0;
  });
  await press(0); // sells the diamond
  await expect.poll(() => coins(page)).toBe(20);
  await press(1); // button 1 closes
  await expect.poll(() => shopOpen(page)).toBe(false);
});
