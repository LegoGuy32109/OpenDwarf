import type { Page } from "@playwright/test";
import { worldBuilder } from "../../src/shared/world-builder.js";
import { OPEN, STONE } from "../../src/shared/terrain.js";
import { evidenceShot } from "./evidence.ts";
import { expect, test } from "./fixtures.ts";
import { waitTicks } from "./time.ts";
import { ready } from "./ui.ts";
import {
  dropItems,
  giveItems,
  openWorld,
  readWorld,
  startWorld,
} from "./world.ts";

const actionSounds = (page: Page) =>
  readWorld(
    page,
    (world) =>
      world.sounds.filter((sound) =>
        ["place", "pickup", "sell"].includes(sound.tags[0])
      ).map((sound) => ({
        tags: sound.tags,
        own: sound.own,
        muffled: sound.muffled,
      })),
  );
const inventory = (page: Page, kind: string) =>
  readWorld(
    page,
    (world, kind) =>
      world.scene.inventory.find((stack) => stack.kind === kind)?.count ?? 0,
    kind,
  );
const notice = (page: Page) =>
  readWorld(page, (world) => world.scene.notice?.text ?? "");
const send = (page: Page, message: Record<string, unknown>) =>
  readWorld(page, (world, message) => world.send(message), message);

/** Each refused request must reach the host before silence can count as evidence. */
async function refuse(
  page: Page,
  message: Record<string, unknown>,
  reason: string,
) {
  const before = await actionSounds(page);
  expect(await send(page, message)).toBe(true);
  await expect.poll(() => notice(page)).toContain(reason);
  await waitTicks(page, 10);
  expect(await actionSounds(page)).toEqual(before);
}

test("guest action sounds follow host acceptance exactly once, and refusals stay silent", async ({ page: host, context }) => {
  const setup = worldBuilder().fill({
    minX: 1,
    maxX: 9,
    minY: 1,
    maxY: 9,
    minZ: 1,
    maxZ: 1,
  }, OPEN).spawn({ x: 4, y: 4, z: 1 }).spawn({ x: 5, y: 4, z: 1 })
    .entity({
      id: "shop",
      name: "Ulgar",
      role: "trader",
      at: { x: 5, y: 3, z: 1 },
      behavior: { id: "still" },
    })
    .definition();
  await startWorld(host, setup);
  await ready(host);
  const session = await readWorld(host, (world) => world.scene.sessionId);
  const guest = await context.newPage();
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    readWorld(guest, (world) => Boolean(world.wireDebug()?.state))
  )
    .toBe(true);
  const id = await readWorld(guest, (world) => world.scene.localId);
  const place = { type: "place", x: 6, y: 4, z: 1 };
  const pickup = { type: "pickup", x: 5, y: 5, z: 1, kind: "coal" };
  const sell = { type: "sell", kind: "coal", count: 1 };
  await refuse(guest, place, "stone");
  await refuse(guest, pickup, "nothing");
  await refuse(guest, sell, "do not have");
  expect(await actionSounds(guest)).toEqual([]);

  await giveItems(host, "stone", 2, id);
  await expect.poll(() => inventory(guest, "stone")).toBe(2);
  expect(await send(guest, { type: "hold", kind: "stone" })).toBe(true);
  await expect.poll(() => readWorld(guest, (world) => world.scene.heldFeed))
    .toBe("stone");
  await guest.keyboard.down("l");
  await guest.keyboard.press("Space");
  await guest.keyboard.up("l");
  await expect.poll(() =>
    readWorld(
      host,
      (world) => world.scene.world.chunks.get("0,0")?.[256 + 4 * 16 + 6],
    )
  )
    .toBe(STONE);
  await expect.poll(() => inventory(guest, "stone")).toBe(1);
  await refuse(guest, place, "not open");

  await dropItems(host, 5, 5, "coal", 1, 1);
  expect(await send(guest, pickup)).toBe(true);
  await expect.poll(() => inventory(guest, "coal")).toBe(1);
  await refuse(guest, pickup, "nothing");

  expect(await send(guest, sell)).toBe(true);
  await expect.poll(() => inventory(guest, "coin")).toBe(1);
  await expect.poll(() => inventory(guest, "coal")).toBe(0);
  await refuse(guest, sell, "do not have");
  // Allow reliable sound delivery and prove there is no duplicate remote echo.
  await waitTicks(guest, 20);
  expect(await actionSounds(guest)).toEqual([
    { tags: ["place", "stone"], own: true, muffled: false },
    { tags: ["pickup"], own: true, muffled: false },
    { tags: ["sell"], own: true, muffled: false },
  ]);
  const accepted = await actionSounds(guest);
  await readWorld(guest, (world) => {
    world.injectPacket({
      type: "action-result",
      attempt: "old-attempt",
      action: "pickup",
      x: 5,
      y: 5,
      z: 1,
    });
    world.injectPacket({
      type: "action-result",
      attempt: world.wireDebug()!.state!.attempt,
      action: "pickup",
      x: NaN,
      y: 5,
      z: 1,
    });
  });
  await waitTicks(guest, 10);
  expect(await actionSounds(guest)).toEqual(accepted);
  await evidenceShot(guest, "action-sounds-accepted-and-refused");
});
