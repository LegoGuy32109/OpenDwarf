import { expect, test } from "./fixtures.ts";
import { openWorld } from "./world.ts";
import { ready } from "./ui.ts";
import { evidenceShot } from "./evidence.ts";

for (const phone of [false, true]) {
  test(`the HTML terminal covers texture loading through the first draw${phone ? " on a phone" : ""}`, async ({ page }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => release = resolve);
    await page.route("**/assets/floor.png", async (route) => {
      await held;
      await route.continue();
    });
    try {
      await openWorld(page, "/?harness=1");
      await expect(page.locator("html")).toHaveAttribute(
        "data-boot-stage",
        "graphics",
      );
      await expect(page.locator("#boot-detail")).toContainText(
        "Textures ready: 7/8",
      );
      await expect(page.locator("#boot-loading")).toBeVisible();
      await expect(page.locator("#boot-log")).toContainText(
        "[ok] Preparing the world",
      );
      await expect(page.locator("#world")).not.toHaveAttribute(
        "data-ready",
        "true",
      );
      await evidenceShot(
        page,
        phone ? "startup-terminal-phone" : "startup-terminal-desktop",
      );
      release();
      await ready(page);
      await expect(page.locator("#boot-loading")).toBeHidden();
      await expect(page.locator("html")).toHaveAttribute("data-booted", "true");
      expect(
        await page.evaluate(() =>
          performance.getEntriesByName("od-first-world-frame").length
        ),
      ).toBe(1);
      await evidenceShot(page, "startup-first-frame");
    } finally {
      release();
    }
  });
}

test("a failed texture stays in the HTML terminal and can be retried", async ({ page }) => {
  await page.route(
    "**/assets/floor.png",
    (route) => route.fulfill({ status: 404 }),
  );
  await openWorld(page, "/?harness=1");
  await expect(page.locator("#boot-error")).toContainText(
    "Cannot load assets/floor.png",
  );
  await expect(page.locator("#boot-loading")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-boot-stage",
    "failed",
  );
  await evidenceShot(page, "startup-texture-error");
  await page.unroute("**/assets/floor.png");
  await page.getByRole("button", { name: "Try again" }).click();
  await ready(page);
  await expect(page.locator("#boot-loading")).toBeHidden();
});

test("the terminal paints while the shell resolves a build and preserves its page", async ({ page }) => {
  const server = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-net",
      "--allow-env",
      "tests/e2e/loading-shell.ts",
    ],
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  const reader = server.stdout.getReader();
  const first = await reader.read();
  reader.releaseLock();
  const { port } = JSON.parse(new TextDecoder().decode(first.value));
  const origin = `http://127.0.0.1:${port}`;
  const commit = "a".repeat(40);
  try {
    await page.goto(
      `${origin}/join/abcdefgh?harness=1`,
    );
    await expect(page.locator("#boot-current")).toContainText(
      "Finding the game build",
    );
    await expect(page.locator("#boot-loading")).toBeVisible();
    await evidenceShot(page, "startup-build-wait");
    await fetch(`${origin}/test/release`).then((response) =>
      response.body?.cancel()
    );
    await expect(page.locator("#selected")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-executed", "true");
    expect(new URL(page.url()).pathname).toBe("/join/abcdefgh");
    expect(new URL(page.url()).search).toBe("?harness=1");
    expect(await page.locator("base").getAttribute("href")).toContain(commit);
    expect(await page.locator("#od-build").textContent()).toContain(
      '"base":"/"',
    );
  } finally {
    server.kill("SIGTERM");
    await server.status;
  }
});
