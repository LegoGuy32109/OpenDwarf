import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { holdTicks, waitFor, waitTicks } from "./time.ts";
import { clickUi, ready, say } from "./ui.ts";
type Position = {
  tick: number;
  x: number;
  y: number;
  z: number;
};
/** Sample each id's drawn position once per frame for `ticks` world ticks. */
async function visualTrace(page: Page, ids: string[], ticks: number) {
  return await readWorld(
    page,
    (__world, { ids, ticks }) =>
      new Promise<Record<string, Position[]>>((resolve) => {
        const traces: Record<string, Position[]> = Object.fromEntries(
          ids.map((id) => [id, []]),
        );
        const game = __world;
        const until = game.scene.world.tick + ticks;
        const sample = () => {
          for (const id of ids) {
            const position = game.visualPosition(id);
            if (position) {
              traces[id].push(position);
            }
          }
          if (game.scene.world.tick < until) {
            requestAnimationFrame(sample);
          } else {
            resolve(traces);
          }
        };
        requestAnimationFrame(sample);
      }),
    { ids, ticks },
  );
}
/** The most a drawn entity may cover in one tick: 4.5 tiles a second, over twice a sprint, so a smoothing catch-up passes and a snap does not. */
const MAX_TILES_PER_TICK = 0.225;
/**
 * Every drawn step stays within walking speed for the ticks between samples, so
 * nothing jumps, and the entity travels. Sparse frames on a slow machine only
 * widen the allowance; they do not fail the check.
 */
function expectContinuous(
  label: string,
  points: Position[],
  minTravel: number,
) {
  expect(points.length, `${label} needs rendered samples`).toBeGreaterThan(4);
  let travel = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const distance = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
      current.z - previous.z,
    );
    // Fractional pacing stamps mark frame start. Interpolation runs later in
    // that frame, so sub-tick stamps cannot bound its elapsed presentation time.
    const ticks = Math.max(1, current.tick - previous.tick);
    expect(
      distance,
      `${label} jumped from ${JSON.stringify(previous)} to ${
        JSON.stringify(current)
      }`,
    )
      .toBeLessThanOrEqual(ticks * MAX_TILES_PER_TICK + 0.02);
    travel += distance;
  }
  expect(travel, `${label} did not move`).toBeGreaterThan(minTravel);
}
test("host and two joining tabs see continuous remote movement", async ({ browser }) => {
  const host = await browser.newPage();
  const first = await browser.newPage();
  const second = await browser.newPage();
  await openWorld(host, "/?harness=1", { npc: true });
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  for (const guest of [first, second]) {
    await openWorld(guest, "/host?harness=1", { npc: true });
    await ready(guest);
    await clickUi(guest, `btn:session:${session}`);
    await expect.poll(() =>
      readWorld(guest, (__world) => __world.scene.localId)
    ).toMatch(/^peer-/);
  }
  const firstId = await readWorld(first, (__world) => __world.scene.localId);
  const secondId = await readWorld(second, (__world) => __world.scene.localId);
  expect(firstId).not.toBe(secondId);
  for (const page of [host, first, second]) {
    await expect.poll(() =>
      readWorld(page, (__world, { firstId, secondId }) => {
        const players = __world.scene.world.players;
        return Boolean(
          players[firstId] && players[secondId] && players.self &&
            players["npc-corner"],
        );
      }, { firstId, secondId })
    ).toBe(true);
  }
  const traces = Promise.all([
    visualTrace(host, [firstId, secondId, "npc-corner"], 36),
    visualTrace(first, ["self", secondId, "npc-corner"], 36),
    visualTrace(second, ["self", firstId, "npc-corner"], 36),
  ]);
  await Promise.all([
    host.keyboard.down("s"),
    first.keyboard.down("e"),
    second.keyboard.down("f"),
  ]);
  const [hostTrace, firstTrace, secondTrace] = await traces;
  await Promise.all([
    host.keyboard.up("s"),
    first.keyboard.up("e"),
    second.keyboard.up("f"),
  ]);
  for (
    const [label, trace] of [
      ["host sees first", hostTrace[firstId]],
      ["host sees second", hostTrace[secondId]],
      ["host sees NPC", hostTrace["npc-corner"]],
      ["first sees host", firstTrace.self],
      ["first sees second", firstTrace[secondId]],
      ["first sees NPC", firstTrace["npc-corner"]],
      ["second sees host", secondTrace.self],
      ["second sees first", secondTrace[firstId]],
      ["second sees NPC", secondTrace["npc-corner"]],
    ] as [
      string,
      Position[],
    ][]
  ) {
    expectContinuous(label, trace, 0.5);
  }
  await second.close();
  await expect.poll(() =>
    readWorld(
      host,
      (__world, id) => Boolean(__world.scene.world.players[id]),
      secondId,
    )
  )
    .toBe(false);
  const before = await readWorld(
    host,
    (__world, id) => __world.scene.world.players[id].y,
    firstId,
  );
  await first.keyboard.down("d");
  try {
    await expect.poll(() =>
      readWorld(
        host,
        (__world, id) => __world.scene.world.players[id].y,
        firstId,
      )
    ).toBeGreaterThan(before + 0.12);
  } finally {
    await first.keyboard.up("d");
  }
  await Promise.all([host.close(), first.close()]);
});
type Positions =
  ({ x: number; y: number; z: number; moving: boolean } | null)[];
async function predictionSeparation(
  host: Page,
  first: Page,
  positions: (page: Page) => Promise<Positions>,
) {
  let largestSeparation = 0;
  for (let sample = 0; sample < 20; sample++) {
    await waitTicks(first, 2);
    const [authoritative, local] = await Promise.all([
      positions(host),
      positions(first),
    ]);
    if (authoritative[0] && local[0]) {
      largestSeparation = Math.max(
        largestSeparation,
        Math.hypot(
          authoritative[0].x - local[0].x,
          authoritative[0].y - local[0].y,
          authoritative[0].z - local[0].z,
        ),
      );
    }
  }
  return largestSeparation;
}

function assertBothMoved(initial: Positions, final: Positions) {
  expect(final[0]?.y).not.toBe(initial[0]?.y);
  expect(final[1]?.y).not.toBe(initial[1]?.y);
}

async function waitRestingPositions(
  host: Page,
  pages: Page[],
  positions: (page: Page) => Promise<Positions>,
) {
  try {
    await waitFor(host, async () => {
      const [authoritative, local, observer] = await Promise.all([
        positions(pages[0]),
        positions(pages[1]),
        positions(pages[2]),
      ]);
      if (!authoritative.every((position) => position && !position.moving)) {
        return false;
      }
      return [local, observer].every((positions) =>
        JSON.stringify(positions) === JSON.stringify(authoritative)
      );
    }, { message: "host, mover and observer agreeing on resting positions" });
  } catch (error) {
    await test.info().attach("resting-positions", {
      body: JSON.stringify(await Promise.all(pages.map(positions)), null, 2),
      contentType: "application/json",
    });
    throw error;
  }
}

test("held and reversed guest movement converges in host and two joining tabs", async ({ browser }) => {
  const host = await browser.newPage();
  const first = await browser.newPage();
  const second = await browser.newPage();
  await openWorld(host, "/?harness=1", { npc: true });
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  for (const guest of [first, second]) {
    await openWorld(guest, "/host?harness=1", { npc: true });
    await ready(guest);
    await clickUi(guest, `btn:session:${session}`);
    await expect.poll(() =>
      readWorld(guest, (__world) => __world.scene.localId)
    ).toMatch(/^peer-/);
  }
  const firstId = await readWorld(first, (__world) => __world.scene.localId);
  const secondId = await readWorld(second, (__world) => __world.scene.localId);
  const positions = async (page: Page) =>
    await readWorld(page, (__world, { firstId, secondId }) => {
      const players = __world.scene.world.players;
      return [firstId, secondId].map((id) => {
        const player = players[id];
        return player
          ? { x: player.x, y: player.y, z: player.z, moving: !!player.move }
          : null;
      });
    }, { firstId, secondId });
  await expect.poll(async () => (await positions(host)).every(Boolean)).toBe(
    true,
  );
  const initial = await positions(host);
  await first.keyboard.down("e");
  await second.keyboard.down("e");
  const largestSeparation = await predictionSeparation(host, first, positions);
  await first.keyboard.up("e");
  await holdTicks(first, "d", 13);
  await second.keyboard.up("e");
  expect(largestSeparation).toBeLessThanOrEqual(1.5);
  // Every tab settles on the host's resting positions.
  await waitRestingPositions(host, [host, first, second], positions);
  const final = await positions(host);
  assertBothMoved(initial, final);
  await Promise.all([host.close(), first.close(), second.close()]);
});
async function driveTo(
  page: Page,
  source: Page,
  id: string,
  key: string,
  axis: "x" | "y",
  target: number,
) {
  const position = () =>
    readWorld(source, (__world, { id, axis }) => {
      const player = __world.scene.world.players[id];
      return player?.[axis] ?? NaN;
    }, { id, axis });
  const initial = await position();
  await page.keyboard.down(key);
  try {
    // Stop as soon as the host reaches this leg. A timed polling interval
    // lets held movement continue between observations and can overshoot.
    await waitFor(source, async () => {
      const current = await position();
      return target > initial
        ? current >= target - 0.12
        : current <= target + 0.12;
    }, { message: `player reaches ${axis}=${target}` });
  } finally {
    await page.keyboard.up(key);
  }
}
test("a guest circles the pillar without leaving a remote sprite behind", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1", { npc: true });
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, "/host?harness=1", { npc: true });
  await ready(guest);
  await clickUi(guest, `btn:session:${session}`);
  await expect.poll(() => readWorld(guest, (__world) => __world.scene.localId))
    .toMatch(/^peer-/);
  const id = await readWorld(guest, (__world) => __world.scene.localId);
  for (
    const [key, axis, target] of [
      ["f", "x", 9],
      ["d", "y", 8],
      ["d", "y", 9],
      ["s", "x", 8],
    ] as [
      string,
      "x" | "y",
      number,
    ][]
  ) {
    await driveTo(guest, host, id, key, axis, target);
  }
  const atRest = (page: Page) =>
    readWorld(page, (__world, playerId) => {
      const player = __world.scene.world.players[playerId];
      return player
        ? { x: player.x, y: player.y, moving: !!player.move }
        : null;
    }, id);
  await expect.poll(async () => {
    const [authoritative, predicted] = await Promise.all([
      atRest(host),
      atRest(guest),
    ]);
    return !!authoritative && !!predicted && !authoritative.moving &&
      !predicted.moving &&
      Math.hypot(authoritative.x - predicted.x, authoritative.y - predicted.y) <
        0.4;
  }).toBe(true);
  const final = await atRest(host);
  expect(final?.x).toBeGreaterThan(7.65);
  expect(final?.x).toBeLessThan(8.35);
  expect(final?.y).toBeGreaterThan(8.65);
  expect(final?.y).toBeLessThan(9.35);
  await Promise.all([host.close(), guest.close()]);
});
test("a guest sees the host move and fade behind the pillar", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1", { npc: true });
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, "/host?harness=1", { npc: true });
  await ready(guest);
  await clickUi(guest, `btn:session:${session}`);
  await expect.poll(() => readWorld(guest, (__world) => __world.scene.localId))
    .toMatch(/^peer-/);
  const id = await readWorld(guest, (__world) => __world.scene.localId);
  for (
    const [key, axis, target] of [
      ["e", "y", 6],
      ["f", "x", 8],
      ["f", "x", 9],
      ["d", "y", 7],
    ] as [
      string,
      "x" | "y",
      number,
    ][]
  ) {
    await driveTo(host, host, "self", key, axis, target);
  }
  for (
    const [key, axis, target] of [
      ["s", "x", 7],
      ["s", "x", 6],
      ["e", "y", 6],
    ] as [
      string,
      "x" | "y",
      number,
    ][]
  ) {
    await driveTo(guest, host, id, key, axis, target);
  }
  await expect.poll(() =>
    readWorld(guest, (__world) => Boolean(__world.scene.world.players.self))
  ).toBe(true);
  const trace = readWorld(guest, (__world) =>
    new Promise<
      Array<{
        y: number;
        opacity: number;
      }>
    >((resolve) => {
      const game = __world;
      const points: Array<{
        y: number;
        opacity: number;
      }> = [];
      const until = game.scene.world.tick + 24;
      const sample = () => {
        const point = game.visualSample("self");
        if (point) {
          points.push({ y: point.y, opacity: point.opacity });
        }
        if (game.scene.world.tick < until) {
          requestAnimationFrame(sample);
        } else {
          resolve(points);
        }
      };
      requestAnimationFrame(sample);
    }));
  await driveTo(host, host, "self", "d", "y", 8);
  const points = await trace;
  expect(points.length).toBeGreaterThan(0);
  // The host can omit the sprite at the next sight update before the guest's
  // delayed presentation has replayed the whole visible part of this move.
  expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(7.02);
  expect(points.some((point) => point.opacity > 0.05 && point.opacity < 0.95))
    .toBe(true);
  await expect.poll(() =>
    readWorld(guest, (__world) => Boolean(__world.scene.world.players.self))
  ).toBe(false);
  await driveTo(host, host, "self", "e", "y", 7);
  await expect.poll(() =>
    readWorld(guest, (__world) => Boolean(__world.scene.world.players.self))
  ).toBe(true);
  await Promise.all([host.close(), guest.close()]);
});
test("guest master mode receives full terrain and entity mode restores only discovered terrain", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1", { npc: true });
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, "/host?harness=1", { npc: true });
  await ready(guest);
  await clickUi(guest, `btn:session:${session}`);
  await expect.poll(() => readWorld(guest, (__world) => __world.scene.localId))
    .toMatch(/^peer-/);
  const state = async () =>
    await readWorld(guest, (__world) => {
      const scene = __world.scene;
      return {
        mode: scene.viewMode,
        terrain: Object.fromEntries(
          [...scene.world.chunks].map(([key, data]) => [key, [...data]]),
        ),
        visible: [...scene.visibility.visible],
        y: scene.world.players[scene.localId]?.y,
      };
    });
  const before = await state();
  // Undiscovered tiles read as UNKNOWN inside a chunk the guest has partly seen.
  expect(Object.values(before.terrain).flat()).toContain(0);
  const command = async (value: string) => {
    await say(guest, value);
  };
  await command("/master");
  await expect.poll(async () => (await state()).mode).toBe("master");
  expect(
    Object.values((await state()).terrain).every((chunk) =>
      chunk.every((tile) => tile !== 0)
    ),
  ).toBe(true);
  await guest.keyboard.down("e");
  await expect.poll(async () => (await state()).y).toBeLessThan(before.y ?? 7);
  await guest.keyboard.up("e");
  await command("/entity");
  await expect.poll(async () => (await state()).mode).toBe("entity");
  const after = await state();
  expect(Object.values(after.terrain).flat()).toContain(0);
  assertNewRevealsVisible(before.terrain, after.terrain, after.visible);
  await Promise.all([host.close(), guest.close()]);
});

function assertNewRevealsVisible(
  before: Record<string, number[]>,
  terrain: Record<string, number[]>,
  visibleTiles: string[],
) {
  const visible = new Set(visibleTiles);
  for (const [key, chunk] of Object.entries(terrain)) {
    const [cx, cy] = key.split(",").map(Number);
    const earlier = before[key];
    for (let index = 0; index < chunk.length; index++) {
      if (knownBefore(earlier, index)) {
        continue;
      }
      if (chunk[index] === 0) {
        continue;
      }
      const z = Math.floor(index / 256);
      const y = cy * 16 + Math.floor(index % 256 / 16);
      const x = cx * 16 + index % 16;
      expect(visible.has(`${x},${y},${z}`)).toBe(true);
    }
  }
}

function knownBefore(chunk: number[] | undefined, index: number) {
  return chunk !== undefined && chunk[index] !== 0;
}
