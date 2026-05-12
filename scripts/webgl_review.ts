#!/usr/bin/env -S deno run -A

import { parse } from "$std/flags/mod.ts";
import {
  basename,
  dirname,
  fromFileUrl,
  join,
  resolve,
} from "$std/path/mod.ts";
import { chromium } from "npm:playwright@1.52.0";
import type { FlowDescriptor } from "../lib/webgl-harness-types.ts";

type JsonObject = Record<string, unknown>;

type ReviewRunConfig = {
  flow: FlowDescriptor;
  url: string;
  outDir: string;
  browserBin: string;
  serve: boolean;
};

type BrowserGlobal = {
  __openDwarfWebGlHarness: {
    loadFlow(d: FlowDescriptor): void;
    stepTick(n: number): Promise<void>;
    captureCheckpoint(name: string): Promise<unknown>;
    setCamera(x: number, y: number, zoom: number): Promise<void>;
    exportReplay(): { events: { type: string }[] };
    exportBundleData(): Promise<{
      replayJson: string;
      manifestJson: string;
      screenshots: { filename: string; dataUrl: string }[];
      states: { filename: string; dataUrl: string }[];
    }>;
  };
};

const REVIEW_FLOW: FlowDescriptor = {
  name: "webgl-step1-single-rock",
  seed: "single-rock-step1",
  camera: { x: 0, y: 0, zoom: 1 },
};
const REVIEW_VIEWPORT = { width: 1920, height: 1080 };
const REVIEW_CAMERA_STEPS = [
  { x: 0, y: 0 },
  { x: 192, y: 0 },
  { x: 384, y: 0 },
  { x: 576, y: 0 },
  { x: 768, y: 0 },
  { x: 960, y: 0 },
];

const repoRoot = resolve(dirname(fromFileUrl(import.meta.url)), "..");

function createRunId() {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const entropy = crypto.getRandomValues(new Uint32Array(1))[0]
    .toString(16)
    .padStart(8, "0");
  return `${stamp}__${entropy}`;
}

async function ensureDir(path: string) {
  await Deno.mkdir(path, { recursive: true });
}

async function waitForHttp(url: string, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function dataUrlToBytes(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]+)?;base64,(.*)$/s);
  if (!match) {
    throw new Error(`Expected base64 data URL, got: ${dataUrl.slice(0, 80)}`);
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function runReview(config: ReviewRunConfig) {
  const runId = createRunId();
  const runDir = join(config.outDir, config.flow.name, runId);
  const screenshotDir = join(runDir, "screenshots");
  const stateDir = join(runDir, "state");
  await ensureDir(screenshotDir);
  await ensureDir(stateDir);

  console.log(`review run: ${runId}`);
  console.log(`target url: ${config.url}`);
  console.log(`serve mode: ${config.serve ? "on" : "off"}`);

  const serverProcess = config.serve
    ? new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "dev.ts"],
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    }).spawn()
    : null;

  try {
    if (serverProcess) {
      await waitForHttp(new URL("/", config.url).toString());
      console.log("server ready");
    }

    const browser = await chromium.launch({
      executablePath: config.browserBin,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    });

    try {
      const context = await browser.newContext({
        viewport: REVIEW_VIEWPORT,
        recordVideo: { dir: runDir, size: REVIEW_VIEWPORT },
      });

      const page = await context.newPage();
      await page.goto(config.url);
      console.log("page navigated");

      await page.waitForFunction(
        () =>
          !!(self as unknown as { __openDwarfWebGlHarness?: unknown })
            .__openDwarfWebGlHarness,
        { timeout: 15_000 },
      );
      console.log("harness ready");

      await page.evaluate((d) => {
        (self as unknown as BrowserGlobal).__openDwarfWebGlHarness.loadFlow(d);
      }, config.flow);
      console.log("flow loaded");

      await page.evaluate(() => {
        const shell = document.querySelector(".webgl-experiment-shell");
        return shell?.requestFullscreen({ navigationUI: "hide" });
      });
      await page.waitForTimeout(300);
      console.log("fullscreen ready");

      // boot: let fullscreen resize settle then capture
      await page.evaluate(() =>
        (self as unknown as BrowserGlobal).__openDwarfWebGlHarness.stepTick(2)
      );
      await page.evaluate(
        (name) =>
          (self as unknown as BrowserGlobal).__openDwarfWebGlHarness
            .captureCheckpoint(name),
        "boot",
      );
      console.log("boot captured");

      // wait for texture
      await page.waitForFunction(() => {
        const h = (self as unknown as BrowserGlobal).__openDwarfWebGlHarness;
        return h.exportReplay().events.some((e) => e.type === "texture_loaded");
      }, { timeout: 15_000 });
      console.log("texture loaded");

      // step a few frames so the rock grid is drawn before capturing
      await page.evaluate(() =>
        (self as unknown as BrowserGlobal).__openDwarfWebGlHarness.stepTick(4)
      );
      await page.evaluate(
        (name) =>
          (self as unknown as BrowserGlobal).__openDwarfWebGlHarness
            .captureCheckpoint(name),
        "single_rock_loaded",
      );
      console.log("single rock captured");

      // camera pan
      for (const [i, step] of REVIEW_CAMERA_STEPS.entries()) {
        await page.evaluate(
          ([x, y]: [number, number]) =>
            (self as unknown as BrowserGlobal).__openDwarfWebGlHarness
              .setCamera(x, y, 1),
          [step.x, step.y] as [number, number],
        );
        await page.evaluate(() =>
          (self as unknown as BrowserGlobal).__openDwarfWebGlHarness.stepTick(4)
        );
        await page.evaluate(
          (name) =>
            (self as unknown as BrowserGlobal).__openDwarfWebGlHarness
              .captureCheckpoint(name),
          `camera_pan_${String(i).padStart(2, "0")}`,
        );
      }
      console.log("camera pan captured");

      // export bundle — screenshots and states come from harness captures above
      const bundleData = await page.evaluate(() =>
        (self as unknown as BrowserGlobal).__openDwarfWebGlHarness
          .exportBundleData()
      );
      console.log("bundle data exported");

      await Deno.writeTextFile(
        join(runDir, "replay.json"),
        bundleData.replayJson,
      );
      await Deno.writeTextFile(
        join(runDir, "manifest.json"),
        bundleData.manifestJson,
      );

      for (const artifact of bundleData.screenshots) {
        await Deno.writeFile(
          join(screenshotDir, basename(artifact.filename)),
          dataUrlToBytes(artifact.dataUrl),
        );
      }

      for (const artifact of bundleData.states) {
        const parsed = JSON.parse(
          new TextDecoder().decode(dataUrlToBytes(artifact.dataUrl)),
        ) as JsonObject;
        await Deno.writeTextFile(
          join(stateDir, basename(artifact.filename)),
          JSON.stringify(parsed, null, 2),
        );
      }

      const video = page.video();
      await context.close();

      if (video) {
        const videoSrc = await video.path();
        await Deno.rename(videoSrc, join(runDir, "video.webm"));
        console.log("video written");
      } else {
        console.log("video not available");
      }

      const replay = JSON.parse(bundleData.replayJson) as JsonObject;
      const manifest = JSON.parse(bundleData.manifestJson) as JsonObject;

      await Deno.writeTextFile(
        join(runDir, "notes.md"),
        [
          `# ${config.flow.name}`,
          "",
          `- seed: ${config.flow.seed}`,
          `- url: ${config.url}`,
          `- viewport: ${REVIEW_VIEWPORT.width}x${REVIEW_VIEWPORT.height}`,
          `- runId: ${runId}`,
          `- replay events: ${
            Array.isArray(replay.events) ? replay.events.length : 0
          }`,
          `- checkpoints: ${
            Array.isArray(manifest.checkpoints)
              ? manifest.checkpoints.length
              : 0
          }`,
          `- screenshots: ${bundleData.screenshots.length}`,
          `- states: ${bundleData.states.length}`,
          `- video: ${video ? "present" : "unavailable"}`,
          "",
          "Outputs:",
          "- replay.json",
          "- manifest.json",
          "- screenshots/",
          "- state/",
          "- video.webm",
        ].join("\n"),
      );

      console.log(`review bundle written to ${runDir}`);
    } finally {
      await browser.close();
    }
  } finally {
    serverProcess?.kill("SIGTERM");
  }
}

if (import.meta.main) {
  const cliArgs = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
  const args = parse(cliArgs, {
    string: ["out-dir", "url", "browser"],
    boolean: ["serve"],
    default: {
      "out-dir": join(repoRoot, "exports"),
      url: "http://127.0.0.1:8000/webgl",
      browser: Deno.env.get("CHROMIUM_BIN") ?? "/usr/bin/chromium",
      serve: true,
    },
  });

  await runReview({
    flow: REVIEW_FLOW,
    url: String(args.url),
    outDir: String(args["out-dir"]),
    browserBin: String(args.browser),
    serve: Boolean(args.serve),
  });
}
