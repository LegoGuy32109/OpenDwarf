import { expect, type Page, test } from "@playwright/test";

type Position = { tick: number; x: number; y: number; z: number };

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
            if (position) traces[id].push(position);
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
    const ticks = Math.max(1, current.tick - previous.tick);
    expect(
      distance,
      `${label} jumped from ${JSON.stringify(previous)} to ${
        JSON.stringify(current)
      }`,
    )
      .toBeLessThanOrEqual(
        ticks * 0.13,
      );
    travel += distance;
  }
  expect(travel, `${label} did not move`).toBeGreaterThan(minTravel);
}

test("host and two joining tabs see continuous remote movement", async ({ browser }) => {
  const host = await browser.newPage();
  const first = await browser.newPage();
  const second = await browser.newPage();
  await host.goto("/?harness=1");
  await expect(host.locator("#loading")).toBeHidden();
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  for (const guest of [first, second]) {
    await guest.goto("/admin?harness=1");
    await expect(guest.locator("#loading")).toBeHidden();
    await guest.locator(`[data-session-id="${session}"]`).click();
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
  await first.keyboard.press("d");
  await expect.poll(() =>
    host.evaluate((id) =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: Record<string, { y: number }> } } };
      }).__od.scene.world.players[id].y, firstId)
  ).toBeGreaterThan(before);
  await Promise.all([host.close(), first.close()]);
});

test("held and reversed guest movement converges in host and two joining tabs", async ({ browser }) => {
  const host = await browser.newPage();
  const first = await browser.newPage();
  const second = await browser.newPage();
  await host.goto("/?harness=1");
  await expect(host.locator("#loading")).toBeHidden();
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  for (const guest of [first, second]) {
    await guest.goto("/admin?harness=1");
    await expect(guest.locator("#loading")).toBeHidden();
    await guest.locator(`[data-session-id="${session}"]`).click();
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

test("a guest can circle the pillar without leaving a remote sprite behind", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await expect(host.locator("#loading")).toBeHidden();
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await guest.goto("/admin?harness=1");
  await expect(guest.locator("#loading")).toBeHidden();
  await guest.locator(`[data-session-id="${session}"]`).click();
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
  const tile = async (page: Page) =>
    await page.evaluate((id) => {
      const player = (globalThis as unknown as {
        __od: {
          scene: {
            world: {
              players: Record<string, { x: number; y: number; move: unknown }>;
            };
          };
        };
      }).__od.scene.world.players[id];
      return player
        ? { x: player.x, y: player.y, moving: !!player.move }
        : null;
    }, id);
  await expect.poll(() => tile(host)).toMatchObject({ x: 8, y: 7 });
  for (
    const [key, x, y] of [
      ["f", 9, 7],
      ["d", 9, 8],
      ["d", 9, 9],
      ["s", 8, 9],
    ] as [string, number, number][]
  ) {
    await guest.keyboard.press(key);
    await expect.poll(() => tile(host), { timeout: 3000 }).toMatchObject({
      x,
      y,
    });
    await expect.poll(async () => !(await tile(host))?.moving).toBe(true);
  }
  await guest.keyboard.press("e");
  await guest.waitForTimeout(600);
  expect(await tile(host)).toMatchObject({ x: 8, y: 9, moving: false });
  expect(await tile(guest)).toMatchObject({ x: 8, y: 9, moving: false });
  const visualGap = await host.evaluate((id) => {
    const game = (globalThis as unknown as {
      __od: {
        scene: {
          world: {
            tick: number;
            players: Record<string, {
              x: number;
              y: number;
              z: number;
              move: {
                startPosition: { x: number; y: number; z: number };
                target: { x: number; y: number; z: number };
                startTick: number;
                durationTicks: number;
              } | null;
            }>;
          };
        };
        visualPosition: (id: string) => Position | null;
      };
    }).__od;
    const visual = game.visualPosition(id);
    const player = game.scene.world.players[id];
    if (!visual || !player) return Infinity;
    const move = player.move;
    const progress = move
      ? Math.max(
        0,
        Math.min(1, (visual.tick - move.startTick) / move.durationTicks),
      )
      : 0;
    const position = move
      ? {
        x: move.startPosition.x +
          (move.target.x - move.startPosition.x) * progress,
        y: move.startPosition.y +
          (move.target.y - move.startPosition.y) * progress,
        z: move.startPosition.z +
          (move.target.z - move.startPosition.z) * progress,
      }
      : player;
    return Math.hypot(
      visual.x - position.x,
      visual.y - position.y,
      visual.z - position.z,
    );
  }, id);
  expect(visualGap).toBeLessThanOrEqual(0.751);
  await expect.poll(async () => {
    const [authoritative, predicted] = await Promise.all([
      tile(host),
      tile(guest),
    ]);
    return !authoritative?.moving && !predicted?.moving &&
      authoritative?.x === predicted?.x &&
      authoritative?.y === predicted?.y;
  }, { timeout: 5000 }).toBe(true);
  await Promise.all([host.close(), guest.close()]);
});

test("a guest sees the host move and fade behind the pillar", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await expect(host.locator("#loading")).toBeHidden();
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await guest.goto("/admin?harness=1");
  await expect(guest.locator("#loading")).toBeHidden();
  await guest.locator(`[data-session-id="${session}"]`).click();
  await expect.poll(() =>
    guest.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { localId: string } } })
        .__od.scene.localId
    )
  ).toMatch(/^peer-/);
  // Keep the host and guest on opposite sides of the pillar's sight edge.
  const playerTile = (id: string) =>
    host.evaluate((playerId) => {
      const player = (globalThis as unknown as {
        __od: {
          scene: {
            world: {
              players: Record<string, { x: number; y: number; move: unknown }>;
            };
          };
        };
      }).__od.scene.world.players[playerId];
      return { x: player.x, y: player.y, moving: !!player.move };
    }, id);
  const step = async (
    page: Page,
    id: string,
    key: string,
    x: number,
    y: number,
  ) => {
    await page.keyboard.press(key);
    await expect.poll(() => playerTile(id)).toMatchObject({ x, y });
    await expect.poll(async () => !(await playerTile(id)).moving).toBe(true);
  };
  await step(host, "self", "e", 7, 6);
  await step(host, "self", "f", 8, 6);
  await step(host, "self", "f", 9, 6);
  await step(host, "self", "d", 9, 7);
  const id = await guest.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
  await step(guest, id, "s", 7, 7);
  await step(guest, id, "s", 6, 7);
  await step(guest, id, "e", 6, 6);
  await expect.poll(() =>
    guest.evaluate(() =>
      Boolean(
        (globalThis as unknown as {
          __od: { scene: { world: { players: Record<string, unknown> } } };
        }).__od.scene.world.players.self,
      )
    )
  ).toBe(true);

  const samples = () =>
    guest.evaluate(() =>
      new Promise<Array<{ y: number; opacity: number }>>((resolve) => {
        const game = (globalThis as unknown as {
          __od: {
            scene: {
              world: {
                tick: number;
                players: Record<string, {
                  viewMotion?: {
                    startTick: number;
                    durationTicks: number;
                    entering: boolean;
                  };
                }>;
              };
            };
            visualPosition: (id: string) => Position | null;
          };
        }).__od;
        const collected: Array<{ y: number; opacity: number }> = [];
        const until = performance.now() + 850;
        const sample = () => {
          const player = game.scene.world.players.self;
          const position = game.visualPosition("self");
          if (player?.viewMotion && position) {
            const motion = player.viewMotion;
            const progress = (position.tick - motion.startTick) /
              motion.durationTicks;
            const blend = Math.max(0, Math.min(1, (progress - 0.25) / 0.5));
            collected.push({
              y: position.y,
              opacity: motion.entering ? blend : 1 - blend,
            });
          }
          if (performance.now() < until) requestAnimationFrame(sample);
          else resolve(collected);
        };
        requestAnimationFrame(sample);
      })
    );
  const leaving = samples();
  await host.keyboard.press("d");
  const trace = await leaving;
  expect(trace.length).toBeGreaterThan(4);
  expect(Math.max(...trace.map((point) => point.y))).toBeGreaterThan(7.1);
  expect(trace.some((point) => point.opacity > 0.1 && point.opacity < 0.9))
    .toBe(true);
  expect(trace.every((point) => point.y < 7.5)).toBe(true);
  await expect.poll(() => playerTile("self")).toMatchObject({
    x: 9,
    y: 8,
    moving: false,
  });
  const entering = samples();
  await host.keyboard.press("e");
  const returnTrace = await entering;
  expect(returnTrace.length).toBeGreaterThan(4);
  expect(
    returnTrace.some((point) => point.opacity > 0.1 && point.opacity < 0.9),
  )
    .toBe(true);
  expect(Math.min(...returnTrace.map((point) => point.y))).toBeLessThan(7.4);
  expect(returnTrace.every((point) => point.y < 7.5)).toBe(true);
  await Promise.all([host.close(), guest.close()]);
});

test("guest master mode receives full terrain and entity mode restores only discovered terrain", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await expect(host.locator("#loading")).toBeHidden();
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await guest.goto("/admin?harness=1");
  await expect(guest.locator("#loading")).toBeHidden();
  await guest.locator(`[data-session-id="${session}"]`).click();
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
              terrain: number[];
              players: Record<string, { y: number }>;
            };
            localId: string;
            visibility: { visible: Set<string> };
          };
        };
      }).__od.scene;
      return {
        mode: scene.viewMode,
        terrain: [...scene.world.terrain],
        visible: [...scene.visibility.visible],
        y: scene.world.players[scene.localId]?.y,
      };
    });
  const before = await state();
  expect(before.terrain).toContain(0);
  const command = async (value: string) => {
    await guest.keyboard.press("/");
    await guest.locator("#chat-input").fill(value);
    await guest.locator("#chat-input").press("Enter");
  };
  await command("/master");
  await expect.poll(async () => (await state()).mode).toBe("master");
  expect((await state()).terrain.every((tile) => tile !== 0)).toBe(true);
  await guest.keyboard.down("e");
  await expect.poll(async () => (await state()).y).toBeLessThan(before.y ?? 7);
  await guest.keyboard.up("e");
  await command("/entity");
  await expect.poll(async () => (await state()).mode).toBe("entity");
  const after = await state();
  expect(after.terrain).toContain(0);
  const visible = new Set(after.visible);
  for (let index = 0; index < after.terrain.length; index++) {
    if (before.terrain[index] !== 0 || after.terrain[index] === 0) continue;
    const z = Math.floor(index / 256);
    const y = Math.floor(index % 256 / 16);
    const x = index % 16;
    expect(visible.has(`${x},${y},${z}`)).toBe(true);
  }
  await Promise.all([host.close(), guest.close()]);
});
