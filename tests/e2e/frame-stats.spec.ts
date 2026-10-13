import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { waitTicks } from "./time.ts";
import { hasUi, ready, uiState } from "./ui.ts";

const COMMIT = "0123abc4567def8";

type Event = {
  kind: string;
  commit?: string;
  detail?: string;
  status?: string;
  metrics?: Record<string, number>;
};

/** Serve the page as the build at `COMMIT`, and collect the telemetry POSTs. */
async function collectTelemetry(page: Page) {
  const events: Event[] = [];
  await page.route((url) => url.pathname === "/", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const config = JSON.stringify({ base: "/", label: "", commit: COMMIT });
    const body = (await response.text()).replace(
      "</head>",
      `<script id="od-build" type="application/json">${config}</script></head>`,
    );
    await route.fulfill({ response, body });
  });
  await page.route("**/api/v1/telemetry", (route) => {
    events.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
  await page.goto("/?harness=1");
  await ready(page);
  // A local world has no session; give it one so the reports go out.
  await page.evaluate(() => {
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId = "e2eframestats1";
  });
  return events;
}

test("a forced long frame sends one spike event, then the rate limit holds", async ({ page }) => {
  const events = await collectTelemetry(page);
  const stall = () =>
    page.evaluate(() =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => {
          // wall-clock: a spike is a frame that really takes over 250 ms, so busy-wait 320 ms.
          const start = performance.now();
          // wall-clock: the same busy-wait reads the clock until 320 ms have passed.
          while (performance.now() - start < 320);
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        })
      )
    );
  await stall();
  await expect.poll(() => events.filter((event) => event.kind === "spike"))
    .toHaveLength(1);
  const spike = events.find((event) => event.kind === "spike")!;
  expect(spike.commit).toBe(COMMIT);
  expect(spike.detail).toMatch(/^\w+ \d+ ms$/);
  expect(spike.metrics?.frameMs).toBeGreaterThan(250);
  await stall();
  await waitTicks(page, 10);
  expect(events.filter((event) => event.kind === "spike")).toHaveLength(1);
  const stats = await page.evaluate(() =>
    (globalThis as unknown as {
      __od: {
        frameStats(): {
          spikes100: number;
          spikeLog: { ms: number; phase: string }[];
        };
      };
    }).__od.frameStats()
  );
  expect(stats.spikes100).toBeGreaterThanOrEqual(2);
  // The second stall is in the log, though a slow machine may log later spikes too.
  expect(stats.spikeLog.filter((entry) => entry.ms > 250).length)
    .toBeGreaterThanOrEqual(2);
});

test("a script error names the error and its file:line", async ({ page }) => {
  const events = await collectTelemetry(page);
  // Throw from a frame callback, outside the evaluate call, so the page reports it.
  await page.evaluate(() => {
    requestAnimationFrame(() => {
      throw new TypeError("x is null");
    });
  });
  await expect.poll(() => events.find((event) => event.kind === "error"))
    .toBeTruthy();
  const error = events.find((event) => event.kind === "error")!;
  expect(error.status).toBe("script-error");
  expect(error.detail).toMatch(/^TypeError: x is null/);
});

test("F3 shows the frame line", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  await page.keyboard.press("F3");
  await expect.poll(() => hasUi(page, "panel:diagnostics")).toBe(true);
  await expect.poll(async () => (await uiState(page)).diagnostics).toMatch(
    /FPS \d+ {2}p95 \d+ {2}max \d+ {2}spikes \d+\/\d+ {2}render [\d.]+ ms {2}quads \d+k?/,
  );
  await evidenceShot(page, "f3-frame-line");
});
