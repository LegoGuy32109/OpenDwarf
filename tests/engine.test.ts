import { expect, test } from "@playwright/test";

test("engine route boots the Rust demo frame", async ({ page }) => {
  await page.goto("/engine");

  const canvas = page.locator("#engine-canvas");
  const errorOverlay = page.locator("#engine-error");

  await expect(canvas).toBeVisible();
  await expect(errorOverlay).toBeHidden();
  await page.waitForTimeout(1_000);
  await expect(canvas).toBeVisible();
});
