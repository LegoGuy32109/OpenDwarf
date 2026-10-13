import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready, tapUi, uiRect } from "./ui.ts";

type Stack = { kind: string; count: number };
type Harness = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      notice?: { text: string };
      inventory: Stack[];
      world: {
        chunks: Map<string, Uint8Array>;
        players: Record<string, { x: number; y: number; z: number }>;
      };
    };
  };
};

const OPEN = 1;
const STONE = 2;
// The authored ore row is at y 1 of level 0, with stone at x 2. Row y 2 is open floor.
const ROW_Y = 1;

const od = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.localId);

const tile = (page: Page, x: number, y = ROW_Y) =>
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

/** The local player's stone count, as the page shows it. */
const stones = (page: Page) =>
  page.evaluate(() => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const inventory = scene.inventory ??
      (scene.world.players[scene.localId] as unknown as { inventory: Stack[] })
        .inventory;
    return inventory.find((stack) => stack.kind === "stone")?.count ?? 0;
  });

/** Give the world host's own player items, as a pickup would. */
const give = (host: Page, kind: string, count: number) =>
  host.evaluate(async ([k, n]) => {
    const items = await import("/src/shared/items.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    items.addStack(
      items.inventoryOf(scene.world.players[scene.localId] as never),
      k as string,
      n as number,
    );
  }, [kind, count]);

/** Host without the corner NPC: it walks the 2x2 square at (2, 2) these specs build on. */
async function startHost(page: Page) {
  await page.goto("/?harness=1");
  await ready(page);
  await page.evaluate(() =>
    (globalThis as unknown as { __od: { removeNpc(): void } }).__od.removeNpc()
  );
}

/** Aim with a look key, press interact, and let go. Interact reads the held look keys itself. */
async function interactAim(page: Page, key: string) {
  await page.keyboard.down(key);
  await page.keyboard.press("Space");
  await page.keyboard.up(key);
}

test(
  "a guest places stone and the host sees it",
  { tag: "@smoke" },
  async ({ browser }) => {
    const host = await browser.newPage();
    const guest = await browser.newPage();
    await startHost(host);
    const session = await host.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    await ready(guest);
    await expect.poll(() => od(guest)).toMatch(/^peer-/);
    const guestId = await od(guest);
    await host.evaluate(async (id) => {
      const items = await import("/src/shared/items.js");
      const scene = (globalThis as unknown as Harness).__od.scene;
      const player = scene.world.players[id] as never;
      items.addStack(items.inventoryOf(player), "stone", 2);
      Object.assign(player, { x: 5, y: 3, previousX: 5, previousY: 3 });
    }, guestId);
    await expect.poll(() => stones(guest)).toBe(2);
    await guest.evaluate(() =>
      (globalThis as unknown as { __od: { send: (m: object) => boolean } }).__od
        .send({ type: "hold", kind: "stone" })
    );
    await expect.poll(() =>
      host.evaluate(
        (id) =>
          ((globalThis as unknown as Harness).__od.scene.world.players[
            id
          ] as unknown as { held?: string }).held,
        guestId,
      )
    ).toBe("stone");
    // The guest aims from what it knows: its held item and its own position.
    await expect.poll(() =>
      guest.evaluate(() => {
        const scene = (globalThis as unknown as Harness).__od
          .scene as unknown as {
            heldFeed?: string;
            localId: string;
            world: { players: Record<string, { x: number; y: number }> };
          };
        const self = scene.world.players[scene.localId];
        return `${scene.heldFeed} ${self?.x},${self?.y}`;
      })
    ).toBe("stone 5,3");
    // North of the guest is the ore row; place on the open tile to the east.
    await interactAim(guest, "l");
    await expect.poll(() => tile(host, 6, 3)).toBe(STONE);
    await expect.poll(() => tile(guest, 6, 3)).toBe(STONE);
    await expect.poll(() => stones(guest)).toBe(1);
    await evidenceShot(guest, "guest-placed-stone");
    // A place out of the guest's reach is refused by the host.
    await guest.evaluate(() =>
      (globalThis as unknown as { __od: { send: (m: object) => boolean } }).__od
        .send({ type: "place", x: 9, y: 3, z: 0 })
    );
    await expect.poll(() => notice(guest)).toBe("out of reach");
    expect(await tile(host, 9, 3)).toBe(OPEN);
    expect(await stones(guest)).toBe(1);
    await Promise.all([host.close(), guest.close()]);
  },
);

test.describe("phone interact button", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });

  test("shows the stone icon while stone is held", async ({ page }) => {
    await startHost(page);
    await evidenceShot(page, "interact-pickaxe-icon");
    await give(page, "stone", 4);
    await tapUi(page, "btn:bag");
    await tapUi(page, "slot:stone");
    await tapUi(page, "btn:bag-close");
    await uiRect(page, "btn:interact");
    await evidenceShot(page, "interact-stone-icon");
  });
});
