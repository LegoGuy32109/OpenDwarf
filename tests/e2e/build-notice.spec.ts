import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { chatDraft, clickUi, expectChat, hasUi, ready, uiState } from "./ui.ts";

type Od = { scene: { menu: boolean } };

const menuOpen = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __od: Od }).__od.scene.menu);

/** Serve the page as the build `main` at `commit`, and answer the status API with `mainCommit`. */
async function asMain(page: Page, commit: string, mainCommit: string) {
  let requests = 0;
  await page.route((url) => url.pathname === "/", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const config = JSON.stringify({ base: "/", label: "main", commit });
    const body = (await response.text()).replace(
      "</head>",
      `<script id="od-build" type="application/json">${config}</script></head>`,
    );
    await route.fulfill({ response, body });
  });
  await page.route("**/api/v1/status", (route) => {
    requests++;
    return route.fulfill({
      json: { main: { commit: mainCommit }, labels: [], sessions: [] },
    });
  });
  return () => requests;
}

test("F3 and the menu show the build", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  await page.keyboard.press("F3");
  await expect.poll(async () => (await uiState(page)).diagnostics).toContain(
    "Build local",
  );
  await page.waitForTimeout(300);
  await evidenceShot(page, "build-f3");
  await page.keyboard.press("F3");
  await page.keyboard.press("Escape");
  await expect.poll(() => hasUi(page, "text:menu-build")).toBe(true);
  await page.keyboard.press("Escape");
});

test("a served build shows its short commit and label", async ({ page }) => {
  await asMain(
    page,
    "0123456789abcdef0123456789abcdef01234567",
    "0123456789abcdef0123456789abcdef01234567",
  );
  await page.goto("/?harness=1");
  await ready(page);
  await page.keyboard.press("F3");
  await expect.poll(async () => (await uiState(page)).diagnostics).toContain(
    "Build 0123456 (main)",
  );
});

test("Q opens and closes the menu, closes the bag first, and types q in chat", async ({ page }) => {
  await page.goto("/?harness=1&tools=1");
  await ready(page);
  await page.keyboard.press("q");
  await expect.poll(() => menuOpen(page)).toBe(true);
  await page.keyboard.press("q");
  await expect.poll(() => menuOpen(page)).toBe(false);
  expect((await uiState(page)).joinOpen).toBe(false);

  await page.keyboard.press("b");
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(true);
  await page.keyboard.press("q");
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(false);
  expect(await menuOpen(page)).toBe(false);

  await page.keyboard.press("t");
  await expectChat(page, true);
  await page.keyboard.press("q");
  expect(await chatDraft(page)).toBe("q");
  expect(await menuOpen(page)).toBe(false);
  await page.keyboard.press("Escape");

  await clickUi(page, "btn:qr");
  await expect.poll(() => hasUi(page, "panel:join")).toBe(true);
  await clickUi(page, "btn:qr");
  await expect.poll(() => hasUi(page, "panel:join")).toBe(false);
});

test("a host on a stale main sees the notice, and a tap reloads", async ({ page }) => {
  const requests = await asMain(page, "a".repeat(40), "b".repeat(40));
  await page.goto("/?harness=1");
  await ready(page);
  expect(await hasUi(page, "btn:update")).toBe(false);
  // Showing the tab again checks at once, without waiting two minutes.
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange"))
  );
  await expect.poll(() => hasUi(page, "btn:update")).toBe(true);
  expect(requests()).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await evidenceShot(page, "update-notice");
  await Promise.all([page.waitForNavigation(), clickUi(page, "btn:update")]);
});

test("a host on the current main shows no notice", async ({ page }) => {
  const requests = await asMain(page, "a".repeat(40), "a".repeat(40));
  await page.goto("/?harness=1");
  await ready(page);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange"))
  );
  await expect.poll(requests).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(await hasUi(page, "btn:update")).toBe(false);
});
