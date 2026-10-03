import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { hasUi, ready, sprintState, tapUi, type UiRect, uiRect } from "./ui.ts";

type Hook = {
  __od: { scene: { world: { players: { self: { x: number } } } } };
};

const staminaValue = async (page: Page) => (await sprintState(page)).stamina;

async function expectClearOfLookStick(page: Page) {
  const toBox = ({ x, y, w, h }: UiRect) => ({
    x,
    y,
    width: w,
    height: h,
  });
  const sprint = toBox(await uiRect(page, "btn:sprint"));
  const look = toBox(await uiRect(page, "stick:look"));
  const move = toBox(await uiRect(page, "stick:move"));
  const view = page.viewportSize()!;
  // The look stick is a circle: its box may overlap, but its edge must not.
  const radius = look.width / 2;
  const centerX = look.x + radius;
  const centerY = look.y + radius;
  const nearestX = Math.max(
    sprint.x,
    Math.min(centerX, sprint.x + sprint.width),
  );
  const nearestY = Math.max(
    sprint.y,
    Math.min(centerY, sprint.y + sprint.height),
  );
  expect(Math.hypot(nearestX - centerX, nearestY - centerY)).toBeGreaterThan(
    radius,
  );
  // Room for the mirrored interact button between the sprint button and the move stick.
  expect(sprint.x).toBeGreaterThan(view.width / 2 - sprint.width);
  expect(sprint.x + sprint.width).toBeLessThan(view.width);
  expect(sprint.y + sprint.height).toBeLessThan(view.height);
  expect(move.x + move.width).toBeLessThan(sprint.x);
}

test.describe("phone sprint button", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  test("fits portrait and landscape and shows stamina", async ({ page }) => {
    await page.goto("/?harness=1");
    await ready(page);
    expect(await hasUi(page, "btn:speed")).toBe(false);
    await expectClearOfLookStick(page);
    await evidenceShot(page, "sprint-portrait");
    await page.setViewportSize({ width: 844, height: 390 });
    await expectClearOfLookStick(page);
    await evidenceShot(page, "sprint-landscape");
  });

  test("stamina line drains, locks, and refills", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/?harness=1");
    await ready(page);
    expect(await staminaValue(page)).toBe(1);
    await tapUi(page, "btn:sprint");
    await expect.poll(async () => (await sprintState(page)).on).toBe(true);
    await evidenceShot(page, "sprint-on");
    await expect.poll(() => staminaValue(page)).toBeLessThan(0.6);
    await expect.poll(async () => (await sprintState(page)).locked, {
      timeout: 8000,
    }).toBe(true);
    await expect.poll(async () => (await sprintState(page)).on).toBe(false);
    await evidenceShot(page, "sprint-locked");
    await tapUi(page, "btn:sprint");
    await expect.poll(async () => (await sprintState(page)).on).toBe(false);
    await expect.poll(() => staminaValue(page), { timeout: 20_000 })
      .toBeGreaterThan(0.99);
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
