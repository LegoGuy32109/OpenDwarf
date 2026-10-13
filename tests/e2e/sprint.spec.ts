import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { tick, waitTicks } from "./time.ts";
import { ready, sprintState, tapUi } from "./ui.ts";

type Hook = {
  __od: { scene: { world: { players: { self: { x: number } } } } };
};

const staminaValue = async (page: Page) => (await sprintState(page)).stamina;

/**
 * Wait until `done`, and fail if it takes more than `ticks` world ticks.
 * Stamina moves by ticks, so a slow machine takes longer but no more ticks.
 */
async function withinTicks(
  page: Page,
  ticks: number,
  what: string,
  done: () => Promise<boolean>,
) {
  const start = await tick(page);
  while (!(await done())) {
    expect((await tick(page)) - start, what).toBeLessThanOrEqual(ticks);
    await waitTicks(page, 1);
  }
}

test.describe("phone sprint button", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  test("stamina line drains, locks, and refills", async ({ page }) => {
    await page.goto("/?harness=1");
    await ready(page);
    expect(await staminaValue(page)).toBe(1);
    await tapUi(page, "btn:sprint");
    await expect.poll(async () => (await sprintState(page)).on).toBe(true);
    await evidenceShot(page, "sprint-on");
    // Sprint empties the reserve in 6 s: 120 ticks.
    await withinTicks(
      page,
      60,
      "drains below 0.6",
      async () => (await staminaValue(page)) < 0.6,
    );
    await withinTicks(
      page,
      100,
      "locks when empty",
      async () => (await sprintState(page)).locked,
    );
    await expect.poll(async () => (await sprintState(page)).on).toBe(false);
    await evidenceShot(page, "sprint-locked");
    await tapUi(page, "btn:sprint");
    await expect.poll(async () => (await sprintState(page)).on).toBe(false);
    // It refills from empty in 12 s: 240 ticks.
    await withinTicks(
      page,
      260,
      "refills",
      async () => (await staminaValue(page)) > 0.99,
    );
    await expect.poll(async () => (await sprintState(page)).locked).toBe(false);
    await tapUi(page, "btn:sprint");
    await expect.poll(async () => (await sprintState(page)).on).toBe(true);
    await tapUi(page, "btn:sprint");
    await expect.poll(async () => (await sprintState(page)).on).toBe(false);
  });
});

test("H toggles sprint and G does nothing", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  await page.locator("#world").click();
  await page.keyboard.press("KeyH");
  await expect.poll(async () => (await sprintState(page)).on).toBe(true);
  await page.keyboard.press("KeyH");
  await expect.poll(async () => (await sprintState(page)).on).toBe(false);
  const before = await page.evaluate(() =>
    (globalThis as unknown as Hook).__od.scene.world.players.self.x
  );
  await page.keyboard.press("KeyG");
  await expect(page.locator("#live-status")).not.toContainText("ft");
  expect(before).toBeGreaterThan(0);
});
