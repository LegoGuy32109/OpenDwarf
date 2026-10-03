import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

type Hook = {
  __od: { scene: { world: { players: { self: { x: number } } } } };
};

const staminaValue = (page: Page) =>
  page.locator("#sprint-button").evaluate((button) =>
    Number(getComputedStyle(button).getPropertyValue("--stamina"))
  );

async function expectClearOfLookStick(page: Page) {
  const sprint = (await page.locator("#sprint-button").boundingBox())!;
  const look = (await page.locator("[data-stick=camera]").boundingBox())!;
  const move = (await page.locator("[data-stick=move]").boundingBox())!;
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
    await expect(page.locator("#loading")).toBeHidden();
    await expect(page.locator("#speed-button")).toHaveCount(0);
    await expectClearOfLookStick(page);
    await evidenceShot(page, "sprint-portrait");
    await page.setViewportSize({ width: 844, height: 390 });
    await expectClearOfLookStick(page);
    await evidenceShot(page, "sprint-landscape");
  });

  test("stamina line drains, locks, and refills", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/?harness=1");
    await expect(page.locator("#loading")).toBeHidden();
    const button = page.locator("#sprint-button");
    expect(await staminaValue(page)).toBe(1);
    await button.tap();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await evidenceShot(page, "sprint-on");
    await expect.poll(() => staminaValue(page)).toBeLessThan(0.6);
    await expect(button).toHaveClass(/is-locked/, { timeout: 8000 });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await evidenceShot(page, "sprint-locked");
    await button.tap();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => staminaValue(page), { timeout: 20_000 })
      .toBeGreaterThan(0.99);
    await expect(button).not.toHaveClass(/is-locked/);
    await button.tap();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await button.tap();
    await expect(button).toHaveAttribute("aria-pressed", "false");
  });
});

test("H toggles sprint and G does nothing", async ({ page }) => {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#world").click();
  await page.keyboard.press("KeyH");
  await expect(page.locator("#sprint-button")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("KeyH");
  await expect(page.locator("#sprint-button")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const before = await page.evaluate(() =>
    (globalThis as unknown as Hook).__od.scene.world.players.self.x
  );
  await page.keyboard.press("KeyG");
  await expect(page.locator("#display-status")).not.toContainText("ft");
  expect(before).toBeGreaterThan(0);
});
