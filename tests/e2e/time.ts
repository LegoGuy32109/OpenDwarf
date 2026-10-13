import type { Page } from "@playwright/test";

// Specs measure game time in world ticks and drawn frames, never in
// milliseconds. A slow machine runs fewer ticks per second, so a fixed sleep or
// a time limit lets a different amount of the game happen; a tick count does
// not. A wait that cannot succeed fails after a number of ticks, so it fails the
// same way on any machine. The only time limit is the config's hang limit, for
// a page whose ticks stopped. tests/lint/e2e_wall_clock_test.ts keeps sleeps,
// clock reads and time limits out of specs.

type Harness = { __od: { scene: { world: { tick: number } } } };

/** Ticks a wait allows by default: 10 s of game time. */
export const DEFAULT_TICKS = 200;

/** The world tick on this page. */
export function tick(page: Page): Promise<number> {
  return page.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.world.tick
  );
}

/**
 * Wait until `check` resolves true. It fails once `maxTicks` world ticks of
 * `page` pass without it, so a wait that cannot succeed fails in game time.
 */
export async function waitFor(
  page: Page,
  check: () => Promise<boolean>,
  { maxTicks = DEFAULT_TICKS, message = "condition" } = {},
) {
  const start = await tick(page);
  for (;;) {
    if (await check()) return;
    const elapsed = (await tick(page)) - start;
    if (elapsed > maxTicks) {
      throw new Error(`${message} was not true within ${maxTicks} ticks`);
    }
  }
}

/**
 * Let `n` world ticks pass on this page (50 ms each at full speed). Use it to
 * check that something does not happen, or to let a timed game effect finish.
 */
export async function waitTicks(page: Page, n: number) {
  const start = await tick(page);
  while ((await tick(page)) < start + n) {
    await page.evaluate(() =>
      new Promise((resolve) => queueMicrotask(() => resolve(null)))
    );
  }
}

/**
 * Wait for `n` drawn frames, so the frame loop has read the input (keys, pads,
 * touches) and laid out the UI. A hidden page draws no frames: use waitTicks.
 */
export async function waitFrames(page: Page, n = 2) {
  await page.evaluate((count) =>
    new Promise<void>((resolve) => {
      let left = count;
      const step = () => --left <= 0 ? resolve() : requestAnimationFrame(step);
      requestAnimationFrame(step);
    }), n);
}

/** Hold `key` for `n` world ticks of this page, then let go. */
export async function holdTicks(page: Page, key: string, n: number) {
  await page.keyboard.down(key);
  try {
    await waitTicks(page, n);
  } finally {
    await page.keyboard.up(key);
  }
}

/**
 * Hold `key` until `done` resolves true, then let go. It fails once `maxTicks`
 * ticks of `page` pass first, such as a walk that is blocked.
 */
export async function holdUntil(
  page: Page,
  key: string,
  done: () => Promise<boolean>,
  { maxTicks = DEFAULT_TICKS, message = `holding ${key}` } = {},
) {
  await page.keyboard.down(key);
  try {
    await waitFor(page, done, { maxTicks, message });
  } finally {
    await page.keyboard.up(key);
  }
}
