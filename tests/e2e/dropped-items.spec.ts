import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { hasUi, ready } from "./ui.ts";

type Stack = { kind: string; count: number };
type Entry = { x: number; y: number; z: number; stacks: Stack[] };
type Harness = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      notice?: { text: string };
      items: Entry[];
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

const OPEN = 1;
const STONE = 2;
// The authored ore row at level 0 sits at y 1: stone x 2, coal 3, iron 4 ... emerald 9.
const ROW_Y = 1;

const tile = (page: Page, x: number, y = ROW_Y) =>
  page.evaluate(
    ([tx, ty]) =>
      (globalThis as unknown as Harness).__od.scene.world.chunks.get("0,0")?.[
        ty * 16 + tx
      ] ?? -1,
    [x, y],
  );

const items = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.items);

const inventory = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.inventory);

const notice = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.notice?.text ?? ""
  );

const systemLines = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.hearingLog.lines
      .filter((line) => line.kind === "system").map((line) => line.text)
  );

const position = (page: Page) =>
  page.evaluate(() => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    return scene.world.players[scene.localId];
  });

/** Stand the host's player still at a position. */
const placeAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[scene.localId] as Record<string, number>;
    Object.assign(player, { x: px, y: py, previousX: px, previousY: py });
  }, [x, y]);

/** Drop items on the host's world, as a finished mining action does. */
const drop = (page: Page, x: number, y: number, kind: string, count = 1) =>
  page.evaluate(async ([px, py, k, n]) => {
    const items = await import("/src/shared/items.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    items.dropItem(
      scene.world,
      { x: px as number, y: py as number, z: 0 },
      k as string,
      n as number,
    );
  }, [x, y, kind, count]);

async function startHost(page: Page) {
  await page.goto("/?harness=1");
  await ready(page);
}

async function walkToRow(page: Page) {
  await page.keyboard.down("e");
  await expect.poll(async () => (await position(page))?.y ?? 9, {
    timeout: 30_000,
  }).toBeLessThan(2.4);
  await page.keyboard.up("e");
  await page.waitForTimeout(350);
}

test("mining drops the item, and interact picks it up", async ({ page }) => {
  test.setTimeout(60_000);
  await startHost(page);
  await page.keyboard.press("Backquote"); // open the hearing log for the video
  await expect.poll(() => hasUi(page, "panel:log")).toBe(true);
  expect(await inventory(page)).toEqual([{ kind: "pickaxe", count: 1 }]);
  await placeAt(page, 2, 2);
  await page.keyboard.down("i"); // aim north at the stone
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(() => tile(page, 2), { timeout: 5000 }).toBe(OPEN);
  await expect.poll(() => items(page)).toEqual([
    { x: 2, y: 1, z: 0, stacks: [{ kind: "stone", count: 1 }] },
  ]);
  await page.waitForTimeout(300);
  await evidenceShot(page, "dropped-stone");
  // Interact on the tile that holds the stone picks it up instead of mining.
  await page.keyboard.press("Space");
  await expect.poll(() => items(page)).toEqual([]);
  expect(await inventory(page)).toEqual([
    { kind: "pickaxe", count: 1 },
    { kind: "stone", count: 1 },
  ]);
  expect(await systemLines(page)).toContain("Picked up stone ×1");
  await page.waitForTimeout(500);
  await evidenceShot(page, "picked-up-stone");
  // Coal is next: its item is coal, and a second stone merges into the stack.
  await page.keyboard.up("i");
  await placeAt(page, 3, 2);
  await page.keyboard.down("i");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(() => items(page), { timeout: 5000 }).toEqual([
    { x: 3, y: 1, z: 0, stacks: [{ kind: "coal", count: 1 }] },
  ]);
  await page.keyboard.up("i");
  await page.keyboard.press("Space"); // no aim: the entity's own tile holds nothing
  await expect.poll(() => notice(page)).toContain("aim at a neighboring tile");
});

test("several kinds on one tile cycle their icons and stack counts", async ({ page }) => {
  await startHost(page);
  await placeAt(page, 4, 2);
  await drop(page, 4, 3, "coal", 3);
  await drop(page, 4, 3, "stone");
  await drop(page, 4, 3, "diamond");
  await drop(page, 4, 3, "coal"); // merges into the coal stack
  await drop(page, 5, 3, "gold ore", 12);
  await drop(page, 3, 3, "emerald");
  await expect.poll(async () => (await items(page)).length).toBe(3);
  const stacks = (await items(page)).find((entry) => entry.x === 4)!.stacks;
  expect(stacks).toEqual([
    { kind: "coal", count: 4 },
    { kind: "stone", count: 1 },
    { kind: "diamond", count: 1 },
  ]);
  await page.waitForTimeout(100);
  await evidenceShot(page, "cycling-tile-a");
  await page.waitForTimeout(1000);
  await evidenceShot(page, "cycling-tile-b");
});

test("a joining player sees drops, and two pickups give the stack to one player", async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await startHost(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  await walkToRow(host);
  await walkToRow(guest);
  const hostTile = Math.round((await position(host))!.x);
  const guestTile = Math.round((await position(guest))!.x);
  expect([hostTile, guestTile]).toEqual([7, 8]);
  expect(await inventory(guest)).toEqual([{ kind: "pickaxe", count: 1 }]);
  // A stack on the guest's tile, within reach of both.
  await drop(host, 8, 2, "iron ore", 2);
  await expect.poll(() => items(guest)).toEqual([
    { x: 8, y: 2, z: 0, stacks: [{ kind: "iron ore", count: 2 }] },
  ]);
  // The host aims east at it; the guest has no aim, so its own tile holds it.
  await host.keyboard.down("l");
  await host.waitForTimeout(150);
  await host.keyboard.press("Space");
  await guest.keyboard.press("Space"); // arrives at the host after the host's own pickup
  // The guest is refused either by the host, or locally when the host's pickup
  // already reached it and the tile shows nothing to pick up. Either way only
  // the host gets the stack, which the inventories below check.
  await expect.poll(() => notice(guest)).toMatch(
    /nothing to pick up|aim at a neighboring tile/,
  );
  expect(await inventory(host)).toEqual([
    { kind: "pickaxe", count: 1 },
    { kind: "iron ore", count: 2 },
  ]);
  expect(await inventory(guest)).toEqual([{ kind: "pickaxe", count: 1 }]);
  await expect.poll(() => items(guest)).toEqual([]);
  await host.keyboard.up("l");
  // A guest picks up on its own: only it hears the line.
  await drop(host, 8, 2, "redstone");
  await expect.poll(() => items(guest)).toHaveLength(1);
  await guest.keyboard.press("Space");
  await expect.poll(() => inventory(guest)).toEqual([
    { kind: "pickaxe", count: 1 },
    { kind: "redstone", count: 1 },
  ]);
  await expect.poll(() => systemLines(guest)).toContain(
    "Picked up redstone ×1",
  );
  expect(await systemLines(host)).not.toContain("Picked up redstone ×1");
  expect(await systemLines(host)).toContain("Picked up iron ore ×2");
  expect(await systemLines(guest)).not.toContain("Picked up iron ore ×2");
  // The host refuses a tile out of the guest's reach.
  await drop(host, 2, 2, "coal");
  await guest.evaluate(() =>
    (globalThis as unknown as Harness).__od.send({
      type: "pickup",
      x: 2,
      y: 2,
      z: 0,
      kind: "coal",
    })
  );
  await expect.poll(() => notice(guest)).toContain("out of reach");
  expect(await tile(host, 2)).toBe(STONE);
  await Promise.all([host.close(), guest.close()]);
});
