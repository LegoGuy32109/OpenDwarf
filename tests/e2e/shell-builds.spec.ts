import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";
// A pushed commit of the public repo; jsDelivr serves it forever.
const PUSHED = "c9dbb28f64adac5f1da62405ea20a1733845e560";
const buildOf = (page: import("@playwright/test").Page) =>
  readWorld(page, (__world) => __world.scene.sessionId);
test("/b/local runs the working tree from this server", async ({ page }) => {
  const origins = new Set<string>();
  page.on("request", (request) => origins.add(new URL(request.url()).origin));
  await openWorld(page, "/b/local?harness=1");
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
    if (url.hostname === "cdn.jsdelivr.net") {
      files.push(url.pathname);
    }
  });
  await openWorld(page, `/b/${PUSHED.slice(0, 7)}?harness=1`);
  // The pushed commit is an old build, so it has no `data-ready` mark: wait for its loading screen.
  await expect(page.locator("#loading")).toBeHidden();
  // Its public join image proves that startup assigned a session ID.
  await expect(page.locator("#join-code")).toHaveAttribute(
    "src",
    /\/qr\/[a-f0-9-]{36}\?link=/,
  );
  expect(files).toContain(
    `/gh/LegoGuy32109/OpenDwarf@${PUSHED}/public/js/app.js`,
  );
  await evidenceShot(page, "shell-builds-sha");
});
