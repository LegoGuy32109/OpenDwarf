import { expect, type Page, test } from "@playwright/test";
import { clickUi, ready, say } from "./ui.ts";

type Position = {
  tick: number;
  x: number;
  y: number;
  z: number;
  time?: number;
};

async function visualTrace(page: Page, ids: string[], durationMs: number) {
  return await page.evaluate(
    ({ ids, durationMs }) =>
      new Promise<Record<string, Position[]>>((resolve) => {
        const traces: Record<string, Position[]> = Object.fromEntries(
          ids.map((id) => [id, []]),
        );
        const game = (globalThis as unknown as {
          __od: { visualPosition: (id: string) => Position | null };
        }).__od;
        const until = performance.now() + durationMs;
        const sample = () => {
          for (const id of ids) {
            const position = game.visualPosition(id);
            if (position) {
              traces[id].push({ ...position, time: performance.now() });
            }
          }
          if (performance.now() < until) requestAnimationFrame(sample);
          else resolve(traces);
        };
        requestAnimationFrame(sample);
      }),
    { ids, durationMs },
  );
}

function expectContinuous(
  label: string,
  points: Position[],
  minTravel: number,
) {
  expect(points.length, `${label} needs rendered samples`).toBeGreaterThan(15);
  let travel = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const distance = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
      current.z - previous.z,
    );
    const elapsed = Math.max(1, (current.time ?? 0) - (previous.time ?? 0));
    expect(
      distance,
      `${label} jumped from ${JSON.stringify(previous)} to ${
        JSON.stringify(current)
      }`,
    )
      .toBeLessThanOrEqual(elapsed * 0.0045 + 0.02);
    travel += distance;
  }
  expect(travel, `${label} did not move`).toBeGreaterThan(minTravel);
}

test("host and two joining tabs see continuous remote movement", async ({ browser }) => {
  const host = await browser.newPage();
  const first = await browser.newPage();
  const second = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  for (const guest of [first, second]) {
    await guest.goto("/host?harness=1");
    await ready(guest);
    await clickUi(guest, `btn:session:${session}`);
    await expect.poll(
      () =>
        guest.evaluate(() =>
          (globalThis as unknown as { __od: { scene: { localId: string } } })
            .__od
            .scene.localId
        ),
      { timeout: 15_000 },
    ).toMatch(/^peer-/);
  }
  const firstId = await first.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
  const secondId = await second.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
  expect(firstId).not.toBe(secondId);
  for (const page of [host, first, second]) {
    await expect.poll(() =>
      page.evaluate(({ firstId, secondId }) => {
        const players = (globalThis as unknown as {
          __od: { scene: { world: { players: Record<string, unknown> } } };
        }).__od.scene.world.players;
        return Boolean(
          players[firstId] && players[secondId] && players.self &&
            players["npc-corner"],
        );
      }, { firstId, secondId })
    ).toBe(true);
  }

  const traces = Promise.all([
    visualTrace(host, [firstId, secondId, "npc-corner"], 1800),
    visualTrace(first, ["self", secondId, "npc-corner"], 1800),
    visualTrace(second, ["self", firstId, "npc-corner"], 1800),
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
    ] as [string, Position[]][]
  ) {
    expectContinuous(label, trace, 0.5);
  }
  await second.close();
  await expect.poll(
    () =>
      host.evaluate((id) =>
        Boolean(
          (globalThis as unknown as {
            __od: { scene: { world: { players: Record<string, unknown> } } };
          }).__od.scene.world.players[id],
        ), secondId),
    { timeout: 8_000 },
  )
    .toBe(false);
  const before = await host.evaluate((id) =>
    (globalThis as unknown as {
      __od: { scene: { world: { players: Record<string, { y: number }> } } };
    }).__od.scene.world.players[id].y, firstId);
  await first.keyboard.down("d");
  try {
    await expect.poll(() =>
      host.evaluate((id) =>
        (globalThis as unknown as {
          __od: {
            scene: { world: { players: Record<string, { y: number }> } };
          };
        }).__od.scene.world.players[id].y, firstId)
    ).toBeGreaterThan(before + 0.12);
  } finally {
    await first.keyboard.up("d");
  }
  await Promise.all([host.close(), first.close()]);
});

test("held and reversed guest movement converges in host and two joining tabs", async ({ browser }) => {
  const host = await browser.newPage();
  const first = await browser.newPage();
  const second = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  for (const guest of [first, second]) {
    await guest.goto("/host?harness=1");
    await ready(guest);
    await clickUi(guest, `btn:session:${session}`);
    await expect.poll(() =>
      guest.evaluate(() =>
        (globalThis as unknown as { __od: { scene: { localId: string } } })
          .__od.scene.localId
      )
    ).toMatch(/^peer-/);
  }
  const firstId = await first.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
  const secondId = await second.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
  const positions = async (page: Page) =>
    await page.evaluate(({ firstId, secondId }) => {
      const players = (globalThis as unknown as {
        __od: {
          scene: {
            world: {
              players: Record<
                string,
                { x: number; y: number; z: number; move: unknown }
              >;
            };
          };
        };
      }).__od.scene.world.players;
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
  let largestSeparation = 0;
  for (let sample = 0; sample < 20; sample++) {
    await first.waitForTimeout(110);
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
  await first.keyboard.up("e");
  await first.keyboard.down("d");
  await first.waitForTimeout(650);
  await first.keyboard.up("d");
  await second.keyboard.up("e");
  expect(largestSeparation).toBeLessThanOrEqual(1.5);
  await expect.poll(async () => {
    const [authoritative, local, observer] = await Promise.all([
      positions(host),
      positions(first),
      positions(second),
    ]);
    return authoritative.every((position, index) =>
      position && !position.moving &&
      local[index] && !local[index]?.moving &&
      observer[index] && !observer[index]?.moving &&
      position.x === local[index]?.x && position.y === local[index]?.y &&
      position.z === local[index]?.z &&
      position.x === observer[index]?.x &&
      position.y === observer[index]?.y &&
      position.z === observer[index]?.z
    );
  }, { timeout: 8000 }).toBe(true);
  const final = await positions(host);
  expect(final[0]?.y).not.toBe(initial[0]?.y);
  expect(final[1]?.y).not.toBe(initial[1]?.y);
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
    source.evaluate(({ id, axis }) => {
      const player = (globalThis as unknown as {
        __od: {
          scene: {
            world: { players: Record<string, { x: number; y: number }> };
          };
        };
      }).__od.scene.world.players[id];
      return player?.[axis] ?? NaN;
    }, { id, axis });
  const initial = await position();
  await page.keyboard.down(key);
  try {
    await expect.poll(position, { timeout: 4000, intervals: [30] })
      [target > initial ? "toBeGreaterThanOrEqual" : "toBeLessThanOrEqual"](
        target > initial ? target - 0.12 : target + 0.12,
      );
  } finally {
    await page.keyboard.up(key);
  }
}

test("a guest circles the pillar without leaving a remote sprite behind", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await guest.goto("/host?harness=1");
  await ready(guest);
  await clickUi(guest, `btn:session:${session}`);
  await expect.poll(() =>
    guest.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { localId: string } } })
        .__od.scene.localId
    )
  ).toMatch(/^peer-/);
  const id = await guest.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
  for (
    const [key, axis, target] of [
      ["f", "x", 9],
      ["d", "y", 8],
      ["d", "y", 9],
      ["s", "x", 8],
    ] as [string, "x" | "y", number][]
  ) {
    await driveTo(guest, host, id, key, axis, target);
  }
  const atRest = (page: Page) =>
    page.evaluate((playerId) => {
      const player = (globalThis as unknown as {
        __od: {
          scene: {
            world: {
              players: Record<string, {
                x: number;
                y: number;
                move: unknown;
              }>;
            };
          };
        };
      }).__od.scene.world.players[playerId];
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
  }, { timeout: 5000 }).toBe(true);
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
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await guest.goto("/host?harness=1");
  await ready(guest);
  await clickUi(guest, `btn:session:${session}`);
  await expect.poll(() =>
    guest.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { localId: string } } })
        .__od.scene.localId
    )
  ).toMatch(/^peer-/);
  const id = await guest.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
  for (
    const [key, axis, target] of [
      ["e", "y", 6],
      ["f", "x", 8],
      ["f", "x", 9],
      ["d", "y", 7],
    ] as [string, "x" | "y", number][]
  ) {
    await driveTo(host, host, "self", key, axis, target);
  }
  for (
    const [key, axis, target] of [
      ["s", "x", 7],
      ["s", "x", 6],
      ["e", "y", 6],
    ] as [string, "x" | "y", number][]
  ) {
    await driveTo(guest, host, id, key, axis, target);
  }
  await expect.poll(() =>
    guest.evaluate(() =>
      Boolean(
        (globalThis as unknown as {
          __od: {
            scene: {
              world: {
                players: Record<string, unknown>;
              };
            };
          };
        }).__od.scene.world.players.self,
      )
    )
  ).toBe(true);
  const trace = guest.evaluate(() =>
    new Promise<
      Array<{
        y: number;
        opacity: number;
      }>
    >((resolve) => {
      const game = (globalThis as unknown as {
        __od: {
          visualSample: (id: string) => { y: number; opacity: number } | null;
        };
      }).__od;
      const points: Array<{ y: number; opacity: number }> = [];
      const until = performance.now() + 1200;
      const sample = () => {
        const point = game.visualSample("self");
        if (point) points.push({ y: point.y, opacity: point.opacity });
        if (performance.now() < until) requestAnimationFrame(sample);
        else resolve(points);
      };
      requestAnimationFrame(sample);
    })
  );
  await driveTo(host, host, "self", "d", "y", 8);
  const points = await trace;
  expect(points.length).toBeGreaterThan(0);
  // The host can omit the sprite at the next sight update before the guest's
  // delayed presentation has replayed the whole visible part of this move.
  expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(7.02);
  expect(points.some((point) => point.opacity > 0.05 && point.opacity < 0.95))
    .toBe(true);
  await expect.poll(() =>
    guest.evaluate(() =>
      Boolean(
        (globalThis as unknown as {
          __od: {
            scene: {
              world: {
                players: Record<string, unknown>;
              };
            };
          };
        }).__od.scene.world.players.self,
      )
    )
  ).toBe(false);
  await driveTo(host, host, "self", "e", "y", 7);
  await expect.poll(() =>
    guest.evaluate(() =>
      Boolean(
        (globalThis as unknown as {
          __od: {
            scene: {
              world: {
                players: Record<string, unknown>;
              };
            };
          };
        }).__od.scene.world.players.self,
      )
    )
  ).toBe(true);
  await Promise.all([host.close(), guest.close()]);
});

test("guest master mode receives full terrain and entity mode restores only discovered terrain", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await guest.goto("/host?harness=1");
  await ready(guest);
  await clickUi(guest, `btn:session:${session}`);
  await expect.poll(() =>
    guest.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
        .scene.localId
    )
  ).toMatch(/^peer-/);
  const state = async () =>
    await guest.evaluate(() => {
      const scene = (globalThis as unknown as {
        __od: {
          scene: {
            viewMode: string;
            world: {
              chunks: Map<string, Uint8Array>;
              players: Record<string, { y: number }>;
            };
            localId: string;
            visibility: { visible: Set<string> };
          };
        };
      }).__od.scene;
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
  const visible = new Set(after.visible);
  for (const [key, chunk] of Object.entries(after.terrain)) {
    const [cx, cy] = key.split(",").map(Number);
    const earlier = before.terrain[key];
    for (let index = 0; index < chunk.length; index++) {
      if (earlier?.[index] !== 0 && earlier !== undefined) continue;
      if (chunk[index] === 0) continue;
      const z = Math.floor(index / 256);
      const y = cy * 16 + Math.floor(index % 256 / 16);
      const x = cx * 16 + index % 16;
      expect(visible.has(`${x},${y},${z}`)).toBe(true);
    }
  }
  await Promise.all([host.close(), guest.close()]);
});
