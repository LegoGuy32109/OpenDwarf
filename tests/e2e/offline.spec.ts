import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { hasUi, ready, uiState } from "./ui.ts";

type Od = {
  scene: { world: { players: Record<string, { x: number; y: number }> } };
  frameStats(): { samples: number };
  startMove(dx: number, dy: number): void;
};

// The service worker is off in every other spec (playwright.config.ts).
test.use({ serviceWorkers: "allow" });

test("the game starts offline after one visit and answers media ranges from the cache", async ({ context, page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?harness=1&tools=1");
  await ready(page);
  // The worker registers after the first frame; wait until it controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve)
      );
    }
  });
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
  )
    .toContain("/sw.js");
  // Online, the host shows its join tools.
  expect(await hasUi(page, "btn:qr")).toBe(true);

  // Play one track's file through the worker, so it is in `od-media`.
  const media = "/media/music/ToneA.ogg?v=2e930227cac2";
  const size = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return (await response.arrayBuffer()).byteLength;
  }, media);
  expect(size).toBeGreaterThan(100);
  // Build files are cached as the page loads them; reload once so the worker has them all.
  await page.reload();
  await ready(page);
  await expect.poll(
    () =>
      page.evaluate(async () => {
        const missing: string[] = [];
        if (!(await (await caches.open("od-pages")).match(location.href))) {
          missing.push(location.href);
        }
        const build = await caches.open("od-build-local");
        const files = performance.getEntriesByType("resource")
          .map((entry) => new URL(entry.name))
          .filter((url) =>
            url.origin === location.origin &&
            /^\/(js|src|assets|css)\//.test(url.pathname)
          );
        for (const url of files) {
          if (!(await build.match(url.href))) missing.push(url.href);
        }
        return missing;
      }),
    { message: "the worker cached the page and its build files" },
  ).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: Od }).__od.frameStats().samples
    )
  ).toBeGreaterThan(5);

  // A single-player world: the menu says offline, with no join link or QR button.
  expect(await hasUi(page, "btn:qr")).toBe(false);
  expect(await hasUi(page, "text:offline")).toBe(true);
  expect((await uiState(page)).qrReady).toBe(false);
  const before = await page.evaluate(() => {
    const world = (globalThis as unknown as { __od: Od }).__od.scene.world;
    return { ...world.players.self };
  });
  await page.evaluate(() =>
    (globalThis as unknown as { __od: Od }).__od.startMove(1, 0)
  );
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: Od }).__od.scene.world.players.self.x
    )
  ).not.toBe(before.x);
  await evidenceShot(page, "offline-play");
  await page.keyboard.press("q");
  await evidenceShot(page, "offline-menu");
  await page.keyboard.press("q");

  // A Range request for the cached track answers 206 from the cache.
  const range = await page.evaluate(async (url) => {
    const response = await fetch(url, { headers: { range: "bytes=0-9" } });
    return {
      status: response.status,
      contentRange: response.headers.get("content-range"),
      length: (await response.arrayBuffer()).byteLength,
    };
  }, media);
  expect(range).toEqual({
    status: 206,
    contentRange: `bytes 0-9/${size}`,
    length: 10,
  });

  // The API stays off the cache: it fails while offline.
  const api = await page.evaluate(() =>
    fetch("/api/v1/status").then(() => "ok", () => "failed")
  );
  expect(api).toBe("failed");

  // Back online, a reload brings the join tools back.
  await context.setOffline(false);
  await page.reload();
  await ready(page);
  expect(await hasUi(page, "btn:qr")).toBe(true);
  expect(errors).toEqual([]);
});
