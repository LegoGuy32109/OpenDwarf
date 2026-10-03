import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import process from "node:process";

/** Start tests/e2e/seed-shell.ts on a free port beside the suite's own, and wait until it answers. */
let nextPort = Number(process.env.PORT ?? "8000") + 20;
async function startShell(seed: boolean) {
  const port = nextPort++;
  const child: ChildProcess = spawn("deno", [
    "run",
    "-A",
    "tests/e2e/seed-shell.ts",
    String(port),
    ...(seed ? ["--seed"] : []),
  ], { env: { ...process.env, OD_LOCAL_BUILD: "1" }, stdio: "ignore" });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await (await fetch(`${origin}/api/v1/status`)).body?.cancel();
      return { origin, stop: () => child.kill() };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child.kill();
  throw new Error("the seeded shell did not start");
}

test("the dashboard shows an empty state for every section", async ({ page }) => {
  const { stop, origin } = await startShell(false);
  try {
    await page.goto(`${origin}/admin`);
    await expect(page.locator("#live")).toContainText("No live sessions.");
    await expect(page.locator("#labels")).toContainText("No labels yet.");
    await expect(page.locator("#main")).toContainText("Nothing is promoted");
    await expect(page.locator("#deploys")).toContainText(
      "No shell deploys recorded.",
    );
    await expect(page.locator("#telemetry")).toContainText(
      "No session telemetry recorded.",
    );
    await expect(page.locator("form, input, button")).toHaveCount(0);
  } finally {
    stop();
  }
});

for (
  const device of [
    { name: "desktop", options: {} },
    {
      name: "phone",
      options: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ]
) {
  test(`the dashboard lists a live session, labels, promotions, deploys, and telemetry on ${device.name}`, async ({ browser }) => {
    const { stop, origin } = await startShell(true);
    const context = await browser.newContext({
      recordVideo: process.env.EVIDENCE
        ? { dir: `exports/playwright-results/admin-dashboard-${device.name}` }
        : undefined,
      ...device.options,
    });
    try {
      // A real host tab starts a live session on this shell.
      const host = await context.newPage();
      await host.goto(`${origin}/b/local/?harness=1`);
      await expect(host.locator("#loading")).toBeHidden();
      const sessionId = await host.evaluate(() =>
        (globalThis as unknown as { __od: { scene: { sessionId: string } } })
          .__od.scene.sessionId
      );
      for (
        const [route, role, rtt] of [
          ["host/srflx", "guest", 38],
          ["relay", "host", null],
        ] as const
      ) {
        const sent = await context.request.post(`${origin}/api/v1/telemetry`, {
          data: {
            kind: "summary",
            session: sessionId,
            role,
            route,
            players: 2,
            frameMeanMs: 8.4,
            frameMaxMs: 21.7,
            rttMs: rtt,
            bytesSent: 120_000,
          },
        });
        expect(sent.ok()).toBe(true);
      }

      const page = await context.newPage();
      await page.goto(`${origin}/admin`);
      const join = `/b/local/join/${sessionId}`;
      await expect(page.locator("#live a")).toHaveAttribute("href", join);
      await expect(page.locator("#live")).toContainText("local");
      await expect(page.locator("#labels")).toContainText("seeded-chunk-gen");
      await expect(page.locator("#labels")).toContainText("admin-dashboard");
      await expect(page.locator("#labels")).toContainText("a1b2c3d");
      await expect(page.locator('#labels a[href="/b/seeded-chunk-gen/"]'))
        .toHaveCount(1);
      await expect(page.locator("#main")).toContainText("Main is b2c3d4e");
      await expect(page.locator("#main")).toContainText("first demo build");
      await expect(page.locator("#main")).toContainText("adds the dashboard");
      await expect(page.locator("#deploys")).toContainText("opendwarf-4k2m9");
      await expect(page.locator("#telemetry")).toContainText("host/srflx");
      await expect(page.locator("#telemetry")).toContainText("38 ms");
      await expect(page.locator("form, input, button")).toHaveCount(0);

      // The page never scrolls sideways, on a phone least of all.
      expect(
        await page.evaluate(() =>
          document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        ),
      ).toBe(true);
      if (process.env.EVIDENCE) {
        await page.screenshot({
          path: `exports/evidence/admin-dashboard-${device.name}.png`,
          fullPage: true,
        });
      }

      // The join link opens the host's build and joins the world.
      const guest = await context.newPage();
      await guest.goto(`${origin}${join}?harness=1`);
      await expect(guest.locator("#loading")).toBeHidden();
    } finally {
      await context.close();
      stop();
    }
  });
}
