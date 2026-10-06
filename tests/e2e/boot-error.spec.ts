import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

test("a normal start marks the page booted and keeps the boot-error screen hidden", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-booted", "true");
  await expect(page.locator("#boot-error")).toBeHidden();
});

test("a module that does not parse shows its error instead of a blank page", async ({ page }) => {
  await page.route("**/src/shared/speech.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "export const broken = ;",
    }));
  await page.goto("/");
  const panel = page.locator("#boot-error");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Open Dwarf could not start.");
  await expect(panel).toContainText("SyntaxError");
  await expect(panel).toContainText("Browser:");
  await evidenceShot(page, "boot-error-syntax");
});

test("a module that cannot load shows which script failed", async ({ page }) => {
  await page.route("**/js/app.js", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  const panel = page.locator("#boot-error");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Could not load");
  await expect(panel).toContainText("app.js");
});
