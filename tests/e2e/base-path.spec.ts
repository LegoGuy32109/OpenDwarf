import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { evidenceShot } from "./evidence.ts";

const GAME_ORIGIN = `http://127.0.0.1:${process.env.PORT ?? "8000"}`;
const TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".png": "image/png",
};

/** Serve the build's files like jsDelivr does: another origin, with CORS. */
function serveAssets() {
  const server = Deno.serve({ port: 0, onListen() {} }, async (request) => {
    const path = new URL(request.url).pathname;
    const roots: Record<string, string> = {
      "/assets/": "public",
      "/css/": "public",
      "/js/": "public",
      "/src/": ".",
    };
    const root = Object.keys(roots).find((prefix) => path.startsWith(prefix));
    if (!root || path.includes("..")) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const body = await Deno.readFile(`${roots[root]}${path}`);
      const extension = path.slice(path.lastIndexOf("."));
      return new Response(body, {
        headers: {
          "content-type": TYPES[extension] ?? "application/octet-stream",
          "access-control-allow-origin": "*",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  return { origin: `http://127.0.0.1:${server.addr.port}`, server };
}

/**
 * Act as the shell: serve the page at /b/test/ and under it with the build's
 * config, and pass /api/ on to the game server. Chromium blocks a page the
 * test fulfils itself from reaching loopback files, so this is a real server.
 */
async function serveShell(assets: string) {
  const html = (await readFile("public/index.html", "utf8")).replace(
    '<base href="/">',
    `<base href="${assets}/">
    <script id="od-build" type="application/json">__CONFIG__</script>`,
  );
  const server = Deno.serve({ port: 0, onListen() {} }, (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return fetch(`${GAME_ORIGIN}${url.pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    }
    if (!/^\/b\/test\/(join\/[a-zA-Z0-9_-]+)?$/.test(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }
    const config = JSON.stringify({
      base: "/b/test/",
      // As the shell does: an empty api means the page's own origin, not the base's.
      api: "",
      label: "test",
      commit: "0123456",
    });
    return new Response(html.replace("__CONFIG__", config), {
      headers: { "content-type": "text/html" },
    });
  });
  return { origin: `http://127.0.0.1:${server.addr.port}`, server };
}

async function startBuild() {
  const assets = serveAssets();
  const shell = await serveShell(assets.origin);
  return { assets, shell: shell.server, PAGE_ORIGIN: shell.origin };
}

const sceneOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    (globalThis as unknown as {
      __od: { scene: { sessionId: string; localId: string } };
    }).__od.scene
  );

test("a build under /b/test/ loads its files from another origin and joins by base", async ({ browser }) => {
  const { assets, shell, PAGE_ORIGIN } = await startBuild();
  // A context made here gets no video from the config, so ask for one.
  const context = await browser.newContext({
    recordVideo: process.env.EVIDENCE
      ? { dir: "exports/playwright-results/base-path-join" }
      : undefined,
  });
  try {
    const host = await context.newPage();
    const pageOrigin: string[] = [];
    host.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === PAGE_ORIGIN && !url.pathname.startsWith("/api/")) {
        pageOrigin.push(url.pathname);
      }
    });
    await host.goto(`${PAGE_ORIGIN}/b/test/?harness=1`);
    await expect(host.locator("#loading")).toBeHidden();
    const { sessionId } = await sceneOf(host);
    // Only the page itself comes from the page origin; the files do not.
    expect(pageOrigin).toEqual(["/b/test/"]);
    // The join link carries the build path, and the QR code encodes it.
    const joinLink = `${PAGE_ORIGIN}/b/test/join/${sessionId}`;
    await expect(host.locator("#join-code")).toHaveAttribute(
      "src",
      `${PAGE_ORIGIN}/api/v1/qr/${sessionId}?link=${
        encodeURIComponent(joinLink)
      }`,
    );
    const qr = await host.request.get(
      `${PAGE_ORIGIN}/api/v1/qr/${sessionId}?link=${
        encodeURIComponent(joinLink)
      }`,
    );
    expect(qr.status()).toBe(200);
    const guest = await context.newPage();
    await guest.goto(`${joinLink}?harness=1`);
    await expect(guest.locator("#loading")).toBeHidden();
    await expect.poll(async () => (await sceneOf(guest)).localId).toMatch(
      /^peer-/,
    );
    await expect.poll(() =>
      host.evaluate(() =>
        Object.keys(
          (globalThis as unknown as {
            __od: { scene: { world: { players: object } } };
          }).__od.scene.world.players,
        ).filter((id) => id.startsWith("peer-")).length
      )
    ).toBe(1);
  } finally {
    await context.close();
    await assets.server.shutdown();
    await shell.shutdown();
  }
});

test("the build under /b/test/ shows its join QR code", async ({ browser }) => {
  const { assets, shell, PAGE_ORIGIN } = await startBuild();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`${PAGE_ORIGIN}/b/test/`);
    await expect(page.locator("#loading")).toBeHidden();
    await page.keyboard.press("q");
    await expect(page.locator("#join-panel")).toBeVisible();
    await expect.poll(() =>
      page.locator("#join-code").evaluate((image: HTMLImageElement) =>
        image.complete && image.naturalWidth > 0
      )
    ).toBe(true);
    await evidenceShot(page, "base-path-test-qr");
  } finally {
    await context.close();
    await assets.server.shutdown();
    await shell.shutdown();
  }
});
