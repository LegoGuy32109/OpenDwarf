import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

type Stack = { kind: string; count: number };
type Harness = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      notice?: { text: string };
      inventory: Stack[];
      chatFeed: { id: string; typing?: boolean }[];
      heldFeed?: string;
      world: {
        chunks: Map<string, Uint8Array>;
        players: Record<
          string,
          { x: number; y: number; z: number; typing: boolean; held?: string }
        >;
      };
    };
  };
};

const OPEN = 1;

const od = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.localId);

const tile = (page: Page, x: number, y = 1) =>
  page.evaluate(
    ([tx, ty]) =>
      (globalThis as unknown as Harness).__od.scene.world.chunks.get("0,0")?.[
        ty * 16 + tx
      ] ?? -1,
    [x, y],
  );

const notice = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.notice?.text ?? ""
  );

/** The host's own held item. */
const held = (page: Page) =>
  page.evaluate(() => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    return scene.world.players[scene.localId].held ?? "pickaxe";
  });

const placeAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[scene.localId] as unknown as Record<
      string,
      number
    >;
    Object.assign(player, { x: px, y: py, previousX: px, previousY: py });
  }, [x, y]);

/** Give a player on the world host items, as a pickup would. */
const give = (host: Page, playerId: string, kind: string, count: number) =>
  host.evaluate(async ([id, k, n]) => {
    const items = await import("/src/shared/items.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    items.addStack(
      items.inventoryOf(scene.world.players[id as string] as never),
      k as string,
      n as number,
    );
  }, [playerId, kind, count]);

async function startHost(page: Page) {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
}

const panel = (page: Page) => page.locator("#inventory-panel");

/**
 * Hold a look key until the selection reaches `kind`, then let go. A fixed hold
 * time misses the step when no frame runs during it, or steps twice when one
 * long frame passes the panel's 180 ms key repeat.
 */
async function step(page: Page, key: string, kind: string) {
  await page.keyboard.down(key);
  await expect(page.locator(".slot.is-selected")).toHaveAttribute(
    "data-kind",
    kind,
  );
  await page.keyboard.up(key);
  await expect(page.locator(".slot.is-selected")).toHaveAttribute(
    "data-kind",
    kind,
  );
}

test("B opens the panel, IJKL moves the selection, and interact holds an item", async ({ page }) => {
  test.setTimeout(60_000);
  await startHost(page);
  const me = await od(page);
  await give(page, me, "coal", 12);
  await give(page, me, "diamond", 3);
  await give(page, me, "gold ore", 2);
  await expect(panel(page)).toBeHidden();
  // Closed, the panel does not block walking.
  const yOf = () =>
    page.evaluate(
      (id) => (globalThis as unknown as Harness).__od.scene.world.players[id].y,
      me,
    );
  const startY = await yOf();
  await page.keyboard.down("e");
  await expect.poll(yOf, { timeout: 5000 }).toBeLessThan(startY);
  await page.keyboard.up("e");

  await placeAt(page, 2, 2);
  await page.keyboard.press("b");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator("#inventory-grid .slot")).toHaveCount(4);
  await expect(page.locator("#held-hud")).toBeVisible();
  // Others see the typing bubble while the panel is open.
  expect(
    await page.evaluate(
      (id) =>
        (globalThis as unknown as Harness).__od.scene.world.players[id].typing,
      me,
    ),
  ).toBe(true);
  await page.waitForTimeout(300);
  await evidenceShot(page, "inventory-desktop");

  // The selection starts on the held pickaxe; L steps right, J back.
  await expect(page.locator(".slot.is-selected")).toHaveAttribute(
    "data-kind",
    "pickaxe",
  );
  await step(page, "l", "coal");
  await step(page, "l", "diamond");
  await step(page, "l", "gold ore");
  await step(page, "j", "diamond");
  await page.keyboard.press("Space"); // interact holds diamond
  await expect.poll(() => held(page)).toBe("diamond");
  await expect(page.locator(".slot.is-held")).toHaveAttribute(
    "data-kind",
    "diamond",
  );
  await evidenceShot(page, "inventory-diamond-held");

  await page.keyboard.press("b");
  await expect(panel(page)).toBeHidden();
  expect(
    await page.evaluate(
      (id) =>
        (globalThis as unknown as Harness).__od.scene.world.players[id].typing,
      me,
    ),
  ).toBe(false);
  // A held diamond prevents mining. Aim north at the stone and interact.
  await page.keyboard.down("i");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(() => notice(page)).toContain("no pickaxe");
  expect(await tile(page, 2)).not.toBe(OPEN);
  await page.keyboard.up("i");

  // Switch back to the pickaxe: Escape closes the panel, not the menu.
  await page.keyboard.press("b");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  expect(
    await page.evaluate(() =>
      document.querySelector("#inventory-panel")?.hasAttribute("hidden")
    ),
  ).toBe(true);
  await page.keyboard.press("b");
  await page.keyboard.down("k");
  await page.waitForTimeout(100);
  await page.keyboard.up("k"); // already on row 0: stays
  await page.locator('.slot[data-kind="pickaxe"]').click(); // a tap holds it
  await expect.poll(() => held(page)).toBe("pickaxe");
  await page.keyboard.press("b");
  await page.keyboard.down("i");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(() => tile(page, 2), { timeout: 5000 }).toBe(OPEN);
  await page.keyboard.up("i");
});

test("changing the held item cancels mining", async ({ page }) => {
  test.setTimeout(60_000);
  await startHost(page);
  const me = await od(page);
  await give(page, me, "coal", 1);
  await placeAt(page, 2, 2);
  await page.keyboard.down("i");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await page.keyboard.press("b");
  await page.keyboard.down("l"); // select coal
  await page.waitForTimeout(120);
  await page.keyboard.up("l");
  await page.keyboard.press("Space");
  await expect.poll(() => held(page)).toBe("coal");
  await page.waitForTimeout(1300);
  expect(await tile(page, 2)).not.toBe(OPEN);
  await page.keyboard.up("i");
});

test("a joining player holds an item through the host and others see its bubble", async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await startHost(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await expect(guest.locator("#loading")).toBeHidden();
  await expect.poll(() => od(guest)).toMatch(/^peer-/);
  const guestId = await od(guest);
  await give(host, guestId, "iron ore", 5);
  await expect.poll(() =>
    guest.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.inventory.length
    )
  ).toBe(2);
  const hostSeesTyping = () =>
    host.evaluate(
      (id) =>
        (globalThis as unknown as Harness).__od.scene.world.players[id].typing,
      guestId,
    );
  await guest.keyboard.press("b");
  await expect(panel(guest)).toBeVisible();
  await expect.poll(hostSeesTyping).toBe(true);
  await expect.poll(() =>
    host.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.chatFeed.filter((record) =>
        record.typing
      ).length
    )
  ).toBe(1);
  await guest.keyboard.down("l");
  await guest.waitForTimeout(120);
  await guest.keyboard.up("l");
  await guest.keyboard.press("Space");
  await expect.poll(() =>
    guest.evaluate(() => (globalThis as unknown as Harness).__od.scene.heldFeed)
  ).toBe("iron ore");
  expect(
    await host.evaluate(
      (id) =>
        (globalThis as unknown as Harness).__od.scene.world.players[id].held,
      guestId,
    ),
  ).toBe("iron ore");
  // The host refuses an item the guest does not carry.
  await guest.evaluate(() =>
    (globalThis as unknown as { __od: { send: (m: unknown) => void } }).__od
      .send({ type: "hold", kind: "diamond" })
  );
  await guest.waitForTimeout(500);
  expect(
    await host.evaluate(
      (id) =>
        (globalThis as unknown as Harness).__od.scene.world.players[id].held,
      guestId,
    ),
  ).toBe("iron ore");
  await guest.keyboard.press("b");
  await expect(panel(guest)).toBeHidden();
  await expect.poll(hostSeesTyping).toBe(false);
  await Promise.all([host.close(), guest.close()]);
});

test("the bag button opens the panel on a phone and a tap holds an item", async ({ browser }) => {
  test.setTimeout(60_000);
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
  await expect(page.locator("#bag-button")).toBeVisible();
  await evidenceShot(page, "inventory-phone-closed");
  await page.locator("#bag-button").tap();
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(300);
  await evidenceShot(page, "inventory-phone");
  await page.locator('.slot[data-kind="diamond"]').tap();
  await expect.poll(() => held(page)).toBe("diamond");
  await page.waitForTimeout(300);
  await evidenceShot(page, "inventory-phone-held");
  await page.locator("#inventory-close").tap();
  await expect(panel(page)).toBeHidden();
  // The interact button drives the panel while it is open, then mines again.
  await page.locator("#bag-button").tap();
  await page.locator('.slot[data-kind="pickaxe"]').tap();
  await expect.poll(() => held(page)).toBe("pickaxe");
  await context.close();
});
