import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

// A pushed commit of the public repo; jsDelivr serves it forever.
const PUSHED = "c9dbb28f64adac5f1da62405ea20a1733845e560";

const buildOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    (globalThis as unknown as {
      __od: { scene: { sessionId: string } };
    }).__od.scene.sessionId
  );

test("/b/local runs the working tree from this server", async ({ page }) => {
  const origins = new Set<string>();
  page.on("request", (request) => origins.add(new URL(request.url()).origin));
  await page.goto("/b/local?harness=1");
  await ready(page);
  expect(await buildOf(page)).toBeTruthy();
  expect([...origins]).toEqual([new URL(page.url()).origin]);
  await evidenceShot(page, "shell-builds-local");
});

test("/b/<sha> of a pushed commit loads its files from jsDelivr and starts a game", async ({ page, request }) => {
  const probe = await request.get(
    `https://cdn.jsdelivr.net/gh/LegoGuy32109/OpenDwarf@${PUSHED}/public/index.html`,
  ).catch(() => null);
  test.skip(!probe?.ok(), "jsDelivr is not reachable from this machine");
  const files: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.hostname === "cdn.jsdelivr.net") files.push(url.pathname);
  });
  await page.goto(`/b/${PUSHED.slice(0, 7)}?harness=1`);
  // The pushed commit is an old build, so it has no `data-ready` mark: wait for its loading screen.
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20_000 });
  expect(await buildOf(page)).toBeTruthy();
  expect(files).toContain(
    `/gh/LegoGuy32109/OpenDwarf@${PUSHED}/public/js/app.js`,
  );
  await evidenceShot(page, "shell-builds-sha");
});

test("an unknown build gets a 404 page that links to /admin", async ({ page }) => {
  const response = await page.goto("/b/no-such-build");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("link", { name: /admin/i })).toHaveAttribute(
    "href",
    "/admin",
  );
  await evidenceShot(page, "shell-builds-404");
});
