import { giveItems as give } from "./world.ts";
import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready, tapUi, uiRect } from "./ui.ts";
type Stack = {
  kind: string;
  count: number;
};
const OPEN = 1;
const STONE = 2;
// The authored ore row is at y 1 of level 0, with stone at x 2. Row y 2 is open floor.
const ROW_Y = 1;
const od = (page: Page) => readWorld(page, (__world) => __world.scene.localId);
const tile = (page: Page, x: number, y = ROW_Y) =>
  readWorld(
    page,
    (__world, [tx, ty]) =>
      __world.scene.world.chunks.get("0,0")?.[ty * 16 + tx] ?? -1,
    [x, y],
  );
const notice = (page: Page) =>
  readWorld(page, (__world) => __world.scene.notice?.text ?? "");
/** The local player's stone count, as the page shows it. */
const stones = (page: Page) =>
  readWorld(page, (__world) => {
    const scene = __world.scene;
    const inventory = scene.inventory ??
      (scene.world.players[scene.localId] as unknown as {
        inventory: Stack[];
      })
        .inventory;
    return inventory.find((stack) => stack.kind === "stone")?.count ?? 0;
  });
/** Host without the corner NPC: it walks the 2x2 square at (2, 2) these specs build on. */
async function startHost(page: Page) {
  await openWorld(page, "/?harness=1");
  await ready(page);
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
    const session = await readWorld(host, (__world) => __world.scene.sessionId);
    await openWorld(guest, `/join/${session}?harness=1`);
    await ready(guest);
    await expect.poll(() => od(guest)).toMatch(/^peer-/);
    const guestId = await od(guest);
    await readWorld(host, (__world, id) => {
      const scene = __world.scene;
      const player = scene.world.players[id];
      __world.edit({
        players: [{
          id: player.id,
          inventory: [{
            kind: "stone",
            count: 2,
          }],
        }],
      });
      __world.edit({
        players: [{
          id: player.id,
          at: {
            x: 5,
            y: 3,
            z: player.z,
          },
        }],
      });
    }, guestId);
    await expect.poll(() => stones(guest)).toBe(2);
    await readWorld(
      guest,
      (__world) => __world.send({ type: "hold", kind: "stone" }),
    );
    await expect.poll(() =>
      readWorld(host, (__world, id) =>
        (__world.scene.world.players[id] as {
          held?: string;
        }).held, guestId)
    ).toBe("stone");
    // The guest aims from what it knows: its held item and its own position.
    await expect.poll(() =>
      readWorld(guest, (__world) => {
        const scene = __world.scene as unknown as {
          heldFeed?: string;
          localId: string;
          world: {
            players: Record<string, {
              x: number;
              y: number;
            }>;
          };
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
    await readWorld(
      guest,
      (__world) => __world.send({ type: "place", x: 9, y: 3, z: 0 }),
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
