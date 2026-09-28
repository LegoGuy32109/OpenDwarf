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
