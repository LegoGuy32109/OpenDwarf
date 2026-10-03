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
/** Two builds: the name of each is its commit. */
const ALPHA = "aaaaaaa";
const BRAVO = "bbbbbbb";
const LABELS: Record<string, string> = { [ALPHA]: "alpha", [BRAVO]: "bravo" };

/** Serve the build's files like jsDelivr does: another origin, with CORS. */
function serveAssets() {
  return Deno.serve({ port: 0, onListen() {} }, async (request) => {
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
}

/**
 * Act as the shell for two builds at /b/aaaaaaa/ and /b/bbbbbbb/: serve each
 * page with its own commit, and pass /api/ on to the game server.
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
    const page = /^\/b\/([0-9a-f]{7})\/(host|join\/[a-zA-Z0-9_-]+)?$/.exec(
      url.pathname,
    );
    if (!page || !LABELS[page[1]]) {
      return new Response("Not found", { status: 404 });
    }
    const config = JSON.stringify({
      base: `/b/${page[1]}/`,
      api: url.origin,
      label: LABELS[page[1]],
      commit: page[1],
    });
    return new Response(html.replace("__CONFIG__", config), {
      headers: { "content-type": "text/html" },
    });
  });
  return { origin: `http://127.0.0.1:${server.addr.port}`, server };
}

async function startBuilds() {
  const assets = serveAssets();
  const shell = await serveShell(`http://127.0.0.1:${assets.addr.port}`);
  return { assets, shell: shell.server, origin: shell.origin };
}

const sceneOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    (globalThis as unknown as {
      __od: { scene: { sessionId: string; localId: string } };
    }).__od.scene
  );

const peersOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    Object.keys(
      (globalThis as unknown as {
        __od: { scene: { world: { players: object } } };
      }).__od.scene.world.players,
    ).filter((id) => id.startsWith("peer-")).length
  );

test("a guest opening a join link on another build lands on the host's build", async ({ browser, request }) => {
  const { assets, shell, origin } = await startBuilds();
  const context = await browser.newContext({
    recordVideo: process.env.EVIDENCE
      ? { dir: "exports/playwright-results/live-sessions-build-mismatch" }
      : undefined,
  });
  try {
    const host = await context.newPage();
    await host.goto(`${origin}/b/${ALPHA}/?harness=1`);
    await expect(host.locator("#loading")).toBeHidden();
    const { sessionId } = await sceneOf(host);
    // The shell recorded the session with the host's build.
    await expect.poll(async () => {
      const live = await (await request.get(`${GAME_ORIGIN}/api/v1/sessions`))
        .json();
      return live.sessions.find((s: { id: string }) => s.id === sessionId)
        ?.build;
    }).toEqual({ commit: ALPHA, label: "alpha", path: `/b/${ALPHA}/` });

    // The guest follows a join link that names another build.
    const guest = await context.newPage();
    await guest.goto(`${origin}/b/${BRAVO}/join/${sessionId}?harness=1`);
    await expect(guest).toHaveURL(
      `${origin}/b/${ALPHA}/join/${sessionId}?harness=1`,
    );
    await expect(guest.locator("#loading")).toBeHidden();
    await expect.poll(async () => (await sceneOf(guest)).localId).toMatch(
      /^peer-/,
    );
    await expect.poll(() => peersOf(host)).toBe(1);
    await evidenceShot(guest, "live-sessions-guest-on-host-build");
  } finally {
    await context.close();
    await assets.shutdown();
    await shell.shutdown();
  }
});

test("a guest on the host's own build stays where it is", async ({ browser }) => {
  const { assets, shell, origin } = await startBuilds();
  const context = await browser.newContext();
  try {
    const host = await context.newPage();
    await host.goto(`${origin}/b/${ALPHA}/?harness=1`);
    await expect(host.locator("#loading")).toBeHidden();
    const { sessionId } = await sceneOf(host);
    const guest = await context.newPage();
    await guest.goto(`${origin}/b/${ALPHA}/join/${sessionId}?harness=1`);
    await expect.poll(() => peersOf(host)).toBe(1);
    expect(guest.url()).toBe(
      `${origin}/b/${ALPHA}/join/${sessionId}?harness=1`,
    );
  } finally {
    await context.close();
    await assets.shutdown();
    await shell.shutdown();
  }
});

test("a world is a live session until its host leaves, then it is history", async ({ browser, request }) => {
  const { assets, shell, origin } = await startBuilds();
  const context = await browser.newContext();
  try {
    const host = await context.newPage();
    await host.goto(`${origin}/b/${ALPHA}/?harness=1`);
    await expect(host.locator("#loading")).toBeHidden();
    const { sessionId } = await sceneOf(host);
    const listed = async (path: string) =>
      ((await (await request.get(`${GAME_ORIGIN}/api/v1/${path}`)).json())
        .sessions as { id: string }[]).some((s) => s.id === sessionId);
    await expect.poll(() => listed("sessions")).toBe(true);
    // The /host page lists it as a world to join.
    const lobby = await context.newPage();
    await lobby.goto(`${origin}/b/${BRAVO}/host`);
    await expect(
      lobby.locator(`button[data-session-id="${sessionId}"]`),
    ).toBeVisible();
    await host.close({ runBeforeUnload: true });
    await expect.poll(() => listed("sessions")).toBe(false);
    await expect.poll(() => listed("sessions/recent")).toBe(true);
  } finally {
    await context.close();
    await assets.shutdown();
    await shell.shutdown();
  }
});
