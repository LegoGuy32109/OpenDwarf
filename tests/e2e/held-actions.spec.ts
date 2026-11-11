import { expect, test } from "./fixtures.ts";
import { readWorld, startWorld } from "./world.ts";
import { ready } from "./ui.ts";
import { waitFor, waitTicks } from "./time.ts";
import { evidenceShot } from "./evidence.ts";
import { worldBuilder } from "../../src/shared/world-builder.js";
import { OPEN, STONE } from "../../src/shared/terrain.js";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

async function pair(host: Page, guest: Page) {
  const definition = worldBuilder().base(OPEN).fill({
    minX: 0,
    maxX: 15,
    minY: 0,
    maxY: 15,
    minZ: 0,
    maxZ: 0,
  }, STONE).spawn({ x: 5, y: 5, z: 1 }).definition();
  await startWorld(host, definition);
  await ready(host);
  await readWorld(host, (world) => {
    world.scene.world.planeZ = 1;
    world.scene.zoom = world.scene.zoomTarget = 0.5;
  });
  const session = await readWorld(host, (world) => world.scene.sessionId);
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  await waitFor(
    guest,
    async () =>
      (await readWorld(guest, (world) => world.scene.localId)).startsWith(
        "peer-",
      ),
  );
  const id = await readWorld(guest, (world) => world.scene.localId);
  await readWorld(host, (world, id) => {
    world.edit({
      players: [
        { id: world.scene.localId, at: { x: 4, y: 5, z: 1 } },
        {
          id,
          at: { x: 5, y: 5, z: 1 },
          inventory: [{ kind: "coin", count: 3 }],
          held: "coin",
        },
      ],
    });
  }, id);
  await waitFor(
    guest,
    async () =>
      await readWorld(guest, (world) => world.scene.world.planeZ === 1),
  );
  return id;
}

const count = (page: Page, kind: string) =>
  readWorld(
    page,
    (world, kind) =>
      world.scene.inventory?.find((stack) => stack.kind === kind)?.count ?? 0,
    kind,
  );

test("host owns guest throwing, visible flight, consumption and ordinary landing", async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  const id = await pair(host, guest);
  await waitFor(guest, async () => await count(guest, "coin") === 3);
  // Observe in the page each frame so a short flight cannot pass between reads.
  const flight = readWorld(guest, (world) =>
    new Promise<boolean>((resolve) => {
      const start = world.scene.world.tick;
      const sample = () => {
        if (
          world.scene.world.throws?.some((entry) =>
            entry.kind === "coin" && entry.remaining > 0
          )
        ) resolve(true);
        else if (world.scene.world.tick - start > 60) resolve(false);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
  await readWorld(
    guest,
    (world) => world.send({ type: "throw", dx: 1, dy: 0 }),
  );
  expect(await flight).toBe(true);
  await waitFor(guest, async () => await count(guest, "coin") === 2);
  await waitFor(
    guest,
    async () =>
      await readWorld(
        guest,
        (world) =>
          world.scene.items?.some((entry) =>
            entry.x === 9 && entry.y === 5 && entry.z === 1 &&
            entry.stacks.some((stack) =>
              stack.kind === "coin" && stack.count === 1
            )
          ) ?? false,
      ),
  );
  expect(
    await readWorld(host, (world, id) =>
      (world.scene.world.players[id] as
        & typeof world.scene.world.players[string]
        & { inventory: { kind: string; count: number }[] }).inventory.find((
          s,
        ) => s.kind === "coin")?.count, id),
  ).toBe(2);
  expect(await readWorld(guest, (world) => world.scene.world.throws ?? []))
    .toEqual([]);
  await readWorld(guest, (world) => {
    world.scene.zoom = world.scene.zoomTarget = 0.5;
  });
  await evidenceShot(guest, "held-actions-guest-landing");
  // A throw cannot supply an origin/count or leave the plane.
  await readWorld(
    guest,
    (world) => world.send({ type: "throw", dx: 1, dy: 0, count: 99, x: 0 }),
  );
  await waitTicks(host, 4);
  expect(await count(guest, "coin")).toBe(2);
  await readWorld(
    guest,
    (world) => world.send({ type: "place", x: 6, y: 5, z: 0 }),
  );
  await waitFor(
    guest,
    async () =>
      await readWorld(
        guest,
        (world) => world.scene.notice?.text.includes("play plane") ?? false,
      ),
  );
  expect(await count(guest, "coin")).toBe(2);
  await Promise.all([host.close(), guest.close()]);
});

test("guest mining expires without renewal and renewed holds finish on both peers", async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  const id = await pair(host, guest);
  await readWorld(host, (world, id) => {
    world.edit({
      players: [{ id, held: "pickaxe" }],
      tiles: [{
        bounds: { minX: 6, maxX: 6, minY: 5, maxY: 5, minZ: 1, maxZ: 1 },
        material: 2,
      }],
    });
  }, id);
  const target = { type: "mine-hold", x: 6, y: 5, z: 1 };
  const began = readWorld(guest, (world) =>
    new Promise<boolean>((resolve) => {
      const start = world.scene.world.tick;
      const sample = () => {
        if (
          world.scene.mineFeed?.entries.some((entry) =>
            entry.id === world.scene.localId
          )
        ) resolve(true);
        else if (world.scene.world.tick - start > 100) resolve(false);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
  await readWorld(guest, (world, target) => world.send(target), target);
  expect(await began).toBe(true);
  await evidenceShot(host, "held-actions-expired-lease");
  await waitTicks(host, 12);
  expect(
    await readWorld(
      host,
      (world) => world.scene.world.chunks.get("0,0")![256 + 5 * 16 + 6],
    ),
  ).toBe(STONE);
  await waitFor(
    guest,
    async () =>
      await readWorld(
        guest,
        (world) => (world.scene.mineFeed?.entries.length ?? -1) === 0,
      ),
    { message: "expired mining feed" },
  );
  for (let i = 0; i < 7; i++) {
    await readWorld(guest, (world, target) => world.send(target), target);
    await waitTicks(host, 4);
  }
  await waitFor(
    guest,
    async () =>
      await readWorld(
        guest,
        (world) =>
          world.scene.world.chunks.get("0,0")?.[256 + 5 * 16 + 6] === 1,
      ),
    { message: "renewed mining completion" },
  );
  await evidenceShot(guest, "held-actions-renewed-mining-done");
  await Promise.all([host.close(), guest.close()]);
});

test("joining and reconnecting during host flight recover current visible throws", async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  await pair(host, guest);
  const session = await readWorld(host, (world) => world.scene.sessionId);
  await readWorld(host, (world) =>
    world.edit({
      players: [{
        id: world.scene.localId,
        inventory: [{ kind: "coin", count: 25 }],
        held: "coin",
      }],
    }));
  // Real host actions continue while WebRTC negotiates; no altered flight speed or fixture stubs.
  const stream = readWorld(host, async (world) => {
    const { startThrow } = await import(
      new URL("../src/shared/throws.js", document.baseURI).href
    );
    return new Promise<void>((resolve) => {
      let last = -Infinity, left = 25;
      const step = () => {
        const tick = world.scene.world.tick;
        if (tick - last >= 4) {
          startThrow(world.scene.world, world.scene.localId, -1, 0);
          last = tick;
          if (--left === 0) {
            resolve();
            return;
          }
        }
        requestAnimationFrame(step);
      };
      step();
    });
  });
  const late = await context.newPage();
  await late.goto(`/join/${session}?harness=1`);
  await ready(late);
  await waitFor(
    late,
    async () =>
      await readWorld(
        late,
        (world) => (world.scene.world.throws?.length ?? 0) > 0,
      ),
  );
  const oldAttempt = await readWorld(
    late,
    (world) => world.wireDebug()?.state?.attempt,
  );
  const cancellations = await readWorld(late, (world, session) => {
    let calls = 0;
    Object.assign(world.scene, { cancelAction: () => calls++ });
    world.join(session);
    return calls;
  }, session);
  expect(cancellations).toBeGreaterThan(0);
  await waitFor(late, async () =>
    await readWorld(late, (world, oldAttempt) => {
      const state = world.wireDebug()?.state;
      return !!state && state.attempt !== oldAttempt &&
        (world.scene.world.throws?.length ?? 0) > 0;
    }, oldAttempt));
  await stream;
  await waitTicks(host, 10);
  await waitFor(
    late,
    async () =>
      await readWorld(
        late,
        (world) =>
          world.scene.items?.some((entry) =>
            entry.x === 0 && entry.y === 5 && entry.stacks.some((stack) =>
              stack.kind === "coin" && stack.count === 25
            )
          ) ?? false,
      ),
  );
  expect(await readWorld(late, (world) => world.scene.world.throws)).toEqual(
    [],
  );
  expect(await readWorld(late, (world) => world.scene.world.planeZ)).toBe(1);
  await Promise.all([host.close(), guest.close(), late.close()]);
});
