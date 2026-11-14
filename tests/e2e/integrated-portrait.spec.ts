import { expect, test } from "./fixtures.ts";
import { facePlayer, openWorld, placePlayer, readWorld } from "./world.ts";
import { hasUi, ready, uiCenter } from "./ui.ts";
import { waitFor, waitFrames, waitTicks } from "./time.ts";
import { evidenceShot } from "./evidence.ts";
import type { Page } from "@playwright/test";
const count = (page: Page, kind: string) =>
  readWorld(
    page,
    (w, kind) => w.scene.inventory.find((s) => s.kind === kind)?.count ?? 0,
    kind,
  );
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
test("real portrait drag throws once while moving, center cancels, and touch release places", async ({ page: host, context }) => {
  await openWorld(host, "/?harness=1&safe=47,0,34,0");
  await ready(host);
  const guest = await context.newPage();
  const session = await readWorld(host, (w) => w.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1&safe=47,0,34,0`);
  await ready(guest);
  await expect.poll(() => readWorld(guest, (w) => w.scene.localId)).toMatch(
    /^peer-/,
  );
  const id = await readWorld(guest, (w) => w.scene.localId);
  await placePlayer(host, 6, 6, 1, id);
  await facePlayer(host, 0, 1, id);
  await readWorld(
    host,
    (w, id) =>
      w.edit({
        players: [{
          id,
          inventory: [{ kind: "coin", count: 4 }, { kind: "stone", count: 4 }],
          held: "coin",
        }],
      }),
    id,
  );
  await expect.poll(() => readWorld(guest, (w) => w.scene.heldFeed)).toBe(
    "coin",
  );
  expect(await hasUi(guest, "stick:look")).toBe(false);
  expect(await hasUi(guest, "btn:log")).toBe(false);
  const action = await uiCenter(guest, "btn:interact"),
    move = await uiCenter(guest, "stick:move");
  const cdp = await context.newCDPSession(guest);
  const left = { id: 1, x: move.x, y: move.y + 30 },
    right = { id: 2, ...action };
  const north = { ...right, y: action.y - 55 };
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    touchPoints: typeof left[],
  ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  await touch("touchStart", [left, right]);
  left.y += 30;
  await touch("touchMove", [left, north]);
  await waitTicks(guest, 2);
  expect(await readWorld(guest, (w) => w.scene.aim)).toEqual({ x: 0, y: -1 });
  expect(
    await readWorld(guest, (w) => w.scene.world.players[w.scene.localId].y),
  ).toBeGreaterThan(6);
  await evidenceShot(guest, "134-portrait-real-aim");
  // Observe actual host flight before releasing, since it lasts only eight ticks.
  const flight = readWorld(host, (w) =>
    new Promise<boolean>((resolve) => {
      const start = w.scene.world.tick;
      const sample = () => {
        if (w.scene.world.throws?.some((t) => t.kind === "coin")) resolve(true);
        else if (w.scene.world.tick - start > 40) resolve(false);
        else requestAnimationFrame(sample);
      };
      sample();
    }));
  await touch("touchEnd", [north]);
  expect(await flight).toBe(true);
  await expect.poll(() => count(guest, "coin")).toBe(3);
  await touch("touchEnd", []);
  await waitFrames(guest);
  expect(await readWorld(guest, (w) => w.scene.aim)).toEqual({ x: 0, y: 1 });
  await waitFor(
    guest,
    () =>
      readWorld(
        guest,
        (w) =>
          w.scene.items.some((e) => e.stacks.some((s) => s.kind === "coin")),
      ),
  );
  await evidenceShot(guest, "134-portrait-real-landing");
  // Aimed then centered stone cancels, without a throw or placement.
  await readWorld(guest, (w) => w.send({ type: "hold", kind: "stone" }));
  await expect.poll(() => readWorld(guest, (w) => w.scene.heldFeed)).toBe(
    "stone",
  );
  await placePlayer(host, 6, 6, 1, id);
  await touch("touchStart", [right]);
  await touch("touchMove", [north]);
  await waitFrames(guest);
  await touch("touchMove", [right]);
  await touch("touchEnd", []);
  await waitTicks(guest, 3);
  expect(await count(guest, "stone")).toBe(4);
  await touch("touchStart", [right]);
  await waitTicks(guest, 3);
  expect(await count(guest, "stone")).toBe(4);
  await touch("touchEnd", []);
  await expect.poll(() => count(guest, "stone")).toBe(3);
  await evidenceShot(guest, "134-portrait-release-wall");
});
