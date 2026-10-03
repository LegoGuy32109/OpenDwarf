import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

type Player = { x: number; y: number; z: number; move?: unknown };
type Harness = {
  __od: {
    scene: {
      sessionId: string;
      viewMode: string;
      viewZ: number;
      zoomTarget: number;
      camera: { x: number; y: number };
      world: {
        chunks: Map<string, Uint8Array>;
        generateChunk?: {
          seed: number;
          stats: { chunks: number; totalMs: number; maxMs: number };
        };
        players: Record<string, Player>;
      };
      localId: string;
    };
  };
};

const chunkKeys = (page: Page) =>
  page.evaluate(() =>
    [...(globalThis as unknown as Harness).__od.scene.world.chunks.keys()]
      .sort()
  );

/** Place the host's own player on a tile, as if it had walked there. */
const placeHost = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[scene.localId];
    player.x = x;
    player.y = y;
  }, [x, y]);

const keysAround = (cx: number, cy: number) => {
  const keys: string[] = [];
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) keys.push(`${x},${y}`);
  }
  return keys;
};

test("the host generates chunks within one chunk of a player, from the seed, and keeps the authored chunk", async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  const authored = async (page: Page) =>
    (await page.evaluate(() => [
      ...(globalThis as unknown as Harness).__od.scene.world.chunks.get(
        "0,0",
      )!,
    ])).join();
  const bytes = (page: Page, key: string) =>
    page.evaluate(
      (key) =>
        [
          ...((globalThis as unknown as Harness).__od.scene.world.chunks.get(
            key,
          ) ?? []),
        ].join(),
      key,
    );
  await first.goto("/?harness=1&seed=alpha");
  await second.goto("/?harness=1&seed=alpha");
  await expect(first.locator("#loading")).toBeHidden();
  await expect(second.locator("#loading")).toBeHidden();
  // The authored chunk starts with its neighbors generated around it.
  await expect.poll(() => chunkKeys(first)).toEqual(keysAround(0, 0).sort());
  const before = await authored(first);
  await placeHost(first, 8.5 + 16 * 5, 8.5 + 16 * 5);
  await placeHost(second, 8.5 + 16 * 5, 8.5 + 16 * 5);
  await expect.poll(() => chunkKeys(first)).toEqual(
    [...keysAround(0, 0), ...keysAround(5, 5)].filter((k, i, all) =>
      all.indexOf(k) === i
    ).sort(),
  );
  // The same seed gives the same generated chunk in another session.
  await expect.poll(() => bytes(second, "5,5")).not.toBe("");
  expect(await bytes(second, "5,5")).toBe(await bytes(first, "5,5"));
  expect(await authored(first)).toBe(before);
  const stats = await first.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.world.generateChunk!.stats
  );
  console.log(
    `host generated ${stats.chunks} chunks, ${
      stats.totalMs.toFixed(2)
    } ms total, ${stats.maxMs.toFixed(2)} ms slowest`,
  );
  expect(stats.maxMs).toBeLessThan(25);
  await Promise.all([first.close(), second.close()]);
});

test("a joining player receives generated chunks only as it reaches and sees them", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1&seed=beta");
  await expect(host.locator("#loading")).toBeHidden();
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await expect(guest.locator("#loading")).toBeHidden();
  await expect.poll(() => chunkKeys(guest)).toContain("0,0");
  // The guest's own world already holds the authored chunk, so wait until the
  // host has accepted the guest's player.
  await expect.poll(() =>
    host.evaluate(() =>
      Object.keys((globalThis as unknown as Harness).__od.scene.world.players)
        .some((id) => id.startsWith("peer-"))
    )
  ).toBe(true);
  // The guest never generates; it holds only chunks it has seen.
  expect(
    await guest.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.world.generateChunk ===
        undefined
    ),
  ).toBe(true);
  const hostKeys = await chunkKeys(host);
  const guestKeys = await chunkKeys(guest);
  expect(hostKeys.length).toBe(9);
  expect(guestKeys.every((key) => hostKeys.includes(key))).toBe(true);
  // Send the host's own player far away so the host generates a new region.
  await placeHost(host, 8.5 + 16 * 8, 8.5);
  await expect.poll(() => chunkKeys(host)).toContain("9,0");
  expect(await chunkKeys(guest)).not.toContain("9,0");
  expect(await chunkKeys(guest)).not.toContain("8,0");
  // Move the guest's entity into an open generated tile; it then sees chunks there.
  const spot = await host.evaluate(() => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const chunk = scene.world.chunks.get("8,0")!;
    for (let i = 0; i < 256; i++) {
      if (chunk[i] === 1) {
        return { x: 8 * 16 + (i % 16), y: Math.floor(i / 16) };
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();
  await host.evaluate(({ x, y }) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const id = Object.keys(scene.world.players).find((id) =>
      id !== scene.localId && id !== "npc-corner"
    )!;
    Object.assign(scene.world.players[id], { x, y, z: 0 });
  }, spot!);
  await expect.poll(() => chunkKeys(guest), { timeout: 15_000 }).toContain(
    "8,0",
  );
  await Promise.all([host.close(), guest.close()]);
});

test("master view shows generated terrain at three levels while chunks appear as the camera moves", async ({ page }) => {
  await page.goto("/?harness=1&seed=evidence");
  await expect(page.locator("#loading")).toBeHidden();
  await page.keyboard.press("/");
  await page.locator("#chat-input").fill("/master");
  await page.locator("#chat-input").press("Enter");
  await expect.poll(() =>
    page.evaluate(() => (globalThis as unknown as Harness).__od.scene.viewMode)
  ).toBe("master");
  // Fly the host's player east, one chunk at a time. Chunks appear ahead of it
  // and the master camera follows. Frame times show the host stays smooth.
  await page.evaluate(() => {
    const w = globalThis as unknown as { frames: number[] } & Harness;
    w.frames = [];
    let last = performance.now();
    const loop = (now: number) => {
      w.frames.push(now - last);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const cameraTo = (x: number, y: number) =>
    page.evaluate(([x, y]) => {
      const scene = (globalThis as unknown as Harness).__od.scene;
      scene.camera.x = x * 64;
      scene.camera.y = y * 64;
    }, [x, y]);
  for (let chunk = 1; chunk <= 5; chunk++) {
    await placeHost(page, 8.5 + chunk * 16, 8.5);
    await expect.poll(() => chunkKeys(page)).toContain(`${chunk + 1},0`);
    await cameraTo(8 + chunk * 16, 8);
    await page.waitForTimeout(500);
  }
  const frames = await page.evaluate(() =>
    (globalThis as unknown as { frames: number[] }).frames
  );
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(
    `host frames while walking into new chunks: ${frames.length} frames, p95 ${
      p95.toFixed(1)
    } ms, worst ${sorted.at(-1)!.toFixed(1)} ms`,
  );
  const cameraSetup = async (z: number) => {
    await page.evaluate((z) => {
      (globalThis as unknown as Harness).__od.scene.viewZ = z;
    }, z);
    await page.waitForTimeout(500);
  };
  await cameraTo(8 + 4 * 16, 8);
  for (const z of [7, 4, 1]) {
    await cameraSetup(z);
    await evidenceShot(page, `generated-master-z${z}`);
  }
});
