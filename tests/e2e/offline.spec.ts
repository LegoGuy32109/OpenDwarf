import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { evidenceShot } from "./evidence.ts";
import { hasUi, ready, uiState } from "./ui.ts";
async function waitForFirstVisitCache(page: import("@playwright/test").Page) {
  await expect.poll(() =>
    page.evaluate(async () => {
      const missing: string[] = [];
      if (!(await (await caches.open("od-pages")).match(location.href))) {
        missing.push(location.href);
      }
      const resolved = new URL(location.href);
      resolved.searchParams.set("__od_page", "1");
      if (!(await (await caches.open("od-pages")).match(resolved.href))) {
        missing.push(resolved.href);
      }
      const build = await caches.open("od-build-local");
      const files = performance.getEntriesByType("resource")
        .map((entry) => new URL(entry.name))
        .filter((url) =>
          url.origin === location.origin &&
          /^\/(js|src|assets|css)\//.test(url.pathname)
        );
      for (const url of files) {
        if (!(await build.match(url.href))) {
          missing.push(url.href);
        }
      }
      return missing;
    }), { message: "the worker cached the first visit and its build files" })
    .toEqual(
      [],
    );
}

// The service worker is off in every other spec (playwright.config.ts).
test.use({ serviceWorkers: "allow" });
for (const entry of ["/", "/b/local"]) {
  test(`one visit to ${entry} supports offline play and cached media ranges`, async ({ context, page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openWorld(page, `${entry}?harness=1&tools=1`);
    await ready(page);
    // A bare preview's original document is outside the slash-terminated scope.
    // It bootstraps through the active registration, then its next navigation
    // into the canonical URL receives worker control.
    expect(new URL(page.url()).pathname).toBe(
      entry === "/" ? "/" : "/b/local/",
    );
    // Online, the host shows its join tools.
    expect(await hasUi(page, "btn:qr")).toBe(true);
    // Keep one fixture track as the music player does, even before worker control.
    const media = "/media/music/ToneA.ogg?v=2e930227cac2";
    const size = await page.evaluate(async (url) => {
      const response = await fetch(url);
      await (await caches.open("od-media")).put(
        new URL(url, location.origin).href,
        response.clone(),
      );
      return (await response.arrayBuffer()).byteLength;
    }, media);
    expect(size).toBeGreaterThan(100);
    // This is the first online visit. Bootstrap keeps the page and resources
    // loaded before worker control, including the final textures, without a reload.
    await waitForFirstVisitCache(page);
    await context.setOffline(true);
    await page.reload();
    await ready(page);
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    ).toContain("/sw.js");
    await expect.poll(() =>
      readWorld(page, (__world) => __world.frameStats().samples)
    ).toBeGreaterThan(5);
    // A single-player world: the menu says offline, with no join link or QR button.
    expect(await hasUi(page, "btn:qr")).toBe(false);
    expect(await hasUi(page, "text:offline")).toBe(true);
    expect((await uiState(page)).qrReady).toBe(false);
    const before = await readWorld(page, (__world) => {
      const world = __world.scene.world;
      return { ...world.players.self };
    });
    await readWorld(page, (__world) => __world.startMove(1, 0));
    await expect.poll(() =>
      readWorld(page, (__world) => __world.scene.world.players.self.x)
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
}

test("one visit through the loading shell caches its resolved document for offline reload", async ({ context, page }) => {
  const server = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-net",
      "--allow-env",
      "tests/e2e/loading-shell.ts",
      "--bootstrap-local",
    ],
    env: { SIGNALING: "local" },
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  const reader = server.stdout.getReader();
  const first = await reader.read();
  reader.releaseLock();
  const { port } = JSON.parse(new TextDecoder().decode(first.value));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await openWorld(page, `http://127.0.0.1:${port}/?harness=1&tools=1`);
    await ready(page);
    await waitForFirstVisitCache(page);
    const documents = await page.evaluate(async () => {
      const cache = await caches.open("od-pages");
      const resolved = new URL(location.href);
      resolved.searchParams.set("__od_page", "1");
      return {
        shell: await (await cache.match(location.href))!.text(),
        build: await (await cache.match(resolved.href))!.text(),
      };
    });
    expect(documents.shell).toContain('data-shell="true"');
    expect(documents.build).not.toContain('data-shell="true"');
    await context.setOffline(true);
    await page.reload();
    await ready(page);
    expect(await hasUi(page, "text:offline")).toBe(true);
    expect(errors).toEqual([]);
    await evidenceShot(page, "offline-loading-shell-first-visit");
  } finally {
    await context.setOffline(false);
    server.kill("SIGTERM");
    await server.status;
  }
});
