// Time master view rendering while the camera pans (docs/features/render-performance.md).
// Start the shell first (`deno task start`), then:
//   deno run -A scripts/benchmark-render.ts [--url=http://127.0.0.1:8000] [--zoom=0.25] [--seconds=6]
// Run it on a GPU with vsync off for real numbers; software WebGL only compares builds.
import { chromium } from "@playwright/test";

const args = new Map(Deno.args.map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const url = args.get("url") ?? "http://127.0.0.1:8000";
const zoom = Number(args.get("zoom") ?? 0.25);
const seconds = Number(args.get("seconds") ?? 6);

type Snapshot = {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  phaseMs: Record<string, number>;
};
type Harness = {
  __od: {
    scene: { viewMode: string; zoomTarget: number };
    frameStats(): Snapshot;
    renderStats(): { tiles: number; quads: number } | null;
  };
};

const browser = await chromium.launch({
  args: [
    "--disable-frame-rate-limit",
    "--disable-gpu-vsync",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
// Time every animation frame callback: the whole of a frame's JS, which includes the render.
await page.addInitScript(() => {
  const times: number[] = [];
  (globalThis as unknown as { __frameJs: number[] }).__frameJs = times;
  const original = globalThis.requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame = (callback) =>
    original((now) => {
      const start = performance.now();
      callback(now);
      times.push(performance.now() - start);
    });
});
await page.goto(`${url}/?harness=1&seed=master-camera&sw=0`);
await page.locator("#world[data-ready=true]").waitFor({ timeout: 30_000 });
await page.keyboard.press("t");
await page.keyboard.type("/master");
await page.keyboard.press("Enter");
await page.evaluate((target) => {
  (globalThis as unknown as Harness).__od.scene.zoomTarget = target;
}, zoom);
await page.waitForTimeout(1500);
// Pan east first so the host generates the terrain, then back west over terrain
// that no longer changes: that leg is what the table reports.
await page.keyboard.down("KeyL");
await page.waitForTimeout(seconds * 1000);
await page.keyboard.up("KeyL");
await page.keyboard.down("KeyJ");
await page.evaluate(() => {
  (globalThis as unknown as { __frameJs: number[] }).__frameJs.length = 0;
});
await page.waitForTimeout(seconds * 1000 * 0.8);
const result = await page.evaluate(() => {
  const od = (globalThis as unknown as Harness).__od;
  return { stats: od.frameStats(), render: od.renderStats() };
});
const samples = await page.evaluate(() =>
  (globalThis as unknown as { __frameJs: number[] }).__frameJs
);
await page.keyboard.up("KeyJ");
await browser.close();
samples.sort((x, y) => x - y);

const { stats, render } = result;
console.log(JSON.stringify(
  {
    zoom,
    frames: stats.samples,
    p50Ms: +stats.p50Ms.toFixed(2),
    p95Ms: +stats.p95Ms.toFixed(2),
    frameJsMsMedian: +samples[Math.floor(samples.length / 2)].toFixed(2),
    frameJsMsP90: +samples[Math.floor(samples.length * 0.9)].toFixed(2),
    tiles: render?.tiles,
    quads: render?.quads,
  },
  null,
  2,
));
