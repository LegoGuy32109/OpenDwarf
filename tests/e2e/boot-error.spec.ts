import { openWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";
test(
  "a normal start marks the page booted and keeps the boot-error screen hidden",
  { tag: "@smoke" },
  async ({ page }) => {
    await openWorld(page, "/");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-booted", "true");
    await expect(page.locator("#boot-error")).toBeHidden();
  },
);
test("a module that does not parse shows its error instead of a blank page", {
  tag: "@smoke",
}, async ({ page }) => {
  await page.route("**/src/shared/speech.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "export const broken = ;",
    }));
  await openWorld(page, "/");
  const panel = page.locator("#boot-error");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Open Dwarf could not start.");
  await expect(panel).toContainText("SyntaxError");
  await expect(panel).toContainText("Browser:");
  await evidenceShot(page, "boot-error-syntax");
});
test(
  "a module that cannot load shows which script failed",
  { tag: "@smoke" },
  async ({ page }) => {
    await page.route("**/js/app.js", (route) => route.fulfill({ status: 404 }));
    await openWorld(page, "/");
    const panel = page.locator("#boot-error");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Could not load");
    await expect(panel).toContainText("app.js");
  },
);
test("files that take longer keep the terminal visible with a retry", async ({ page }) => {
  await page.clock.install();
  // Hold the stylesheet and the entry module forever, as a blocked CDN would.
  await page.route("**/css/app.css", () => {});
  await page.route("**/js/app.js", () => {});
  await openWorld(page, "/", { waitUntil: "commit" });
  await page.waitForSelector("#boot-error", { state: "attached" });
  await page.clock.fastForward(16000);
  const panel = page.locator("#boot-error");
  await expect(panel).toBeHidden();
  await expect(page.locator("#boot-current")).toContainText(
    "Loading game code",
  );
  await expect(page.locator("#boot-detail")).toContainText(
    "Taking longer than usual",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await evidenceShot(page, "boot-loading-waiting");
});
