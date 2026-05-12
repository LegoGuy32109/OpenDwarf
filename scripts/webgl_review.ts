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

type JsonObject = Record<string, unknown>;

type ReviewRunConfig = {
  flow: string;
  url: string;
  outDir: string;
  browserBin: string;
  serve: boolean;
};

const FLOW_NAME = "webgl-step1-single-rock";
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
  const runDir = join(config.outDir, config.flow, runId);
  const screenshotDir = join(runDir, "screenshots");
  const frameDir = join(runDir, "frames");
  const stateDir = join(runDir, "state");
  await ensureDir(screenshotDir);
  await ensureDir(frameDir);
  await ensureDir(stateDir);

  console.log(`review run: ${runId}`);
  console.log(`target url: ${config.url}`);
  console.log(`serve mode: ${config.serve ? "on" : "off"}`);

  const serverProcess = config.serve
    ? new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "main.ts"],
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
          !!(globalThis as unknown as { __openDwarfWebGlHarness?: unknown })
            .__openDwarfWebGlHarness,
        { timeout: 15_000 },
      );
      console.log("harness ready");

      await page.evaluate((flow) => {
        (globalThis as unknown as {
          __openDwarfWebGlHarness: { loadFlow(f: string): void };
        })
          .__openDwarfWebGlHarness.loadFlow(flow);
      }, config.flow);
      console.log("flow loaded");

      // fullscreen the canvas shell so the framebuffer is the full 1920x1080 viewport
      await page.evaluate(() => {
        // deno-lint-ignore no-explicit-any
        const shell = (globalThis as any).document?.querySelector(
          ".webgl-experiment-shell",
        );
        // deno-lint-ignore no-explicit-any
        return shell?.requestFullscreen({ navigationUI: "hide" as any });
      });
      await page.waitForTimeout(300);
      console.log("fullscreen requested");

      // boot checkpoint
      const bootPath = join(screenshotDir, "000_boot.png");
      await page.screenshot({ path: bootPath });
      await Deno.copyFile(bootPath, join(frameDir, "000_boot.png"));
      console.log("boot checkpoint captured");

      // wait for texture
      await page.waitForFunction(() => {
        const h = (globalThis as unknown as {
          __openDwarfWebGlHarness?: {
            exportReplay(): { events: { type: string }[] };
          };
        }).__openDwarfWebGlHarness;
        return h?.exportReplay().events.some((e) =>
          e.type === "texture_loaded"
        ) ?? false;
      }, { timeout: 15_000 });
      console.log("texture loaded");

      const rockPath = join(screenshotDir, "010_single_rock_loaded.png");
      await page.screenshot({ path: rockPath });
      await Deno.copyFile(
        rockPath,
        join(frameDir, "010_single_rock_loaded.png"),
      );
      console.log("single rock checkpoint captured");

      // camera pan
      for (const [i, step] of REVIEW_CAMERA_STEPS.entries()) {
        await page.evaluate(
          ([x, y]: [number, number]) => {
            (globalThis as unknown as {
              __openDwarfWebGlHarness: {
                setCamera(x: number, y: number, z: number): void;
              };
            })
              .__openDwarfWebGlHarness.setCamera(x, y, 1);
          },
          [step.x, step.y] as [number, number],
        );
        await page.waitForTimeout(120);
        const label = `camera_pan_${String(i).padStart(2, "0")}`;
        const ordinal = String(20 + i * 10).padStart(3, "0");
        const panPath = join(screenshotDir, `${ordinal}_${label}.png`);
        await page.screenshot({ path: panPath });
        await Deno.copyFile(panPath, join(frameDir, `${ordinal}_${label}.png`));
      }
      console.log("camera pan captured");

      // get replay/manifest/state from harness
      const bundleData = await page.evaluate(() =>
        (globalThis as unknown as {
          __openDwarfWebGlHarness: {
            exportBundleData(): Promise<{
              replayJson: string;
              manifestJson: string;
              states: { filename: string; dataUrl: string }[];
            }>;
          };
        }).__openDwarfWebGlHarness.exportBundleData()
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

      for (const artifact of bundleData.states) {
        const parsed = JSON.parse(
          new TextDecoder().decode(dataUrlToBytes(artifact.dataUrl)),
        ) as JsonObject;
        await Deno.writeTextFile(
          join(stateDir, basename(artifact.filename)),
          JSON.stringify(parsed, null, 2),
        );
      }

      // close context to finalize video recording
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
          `# ${config.flow}`,
          "",
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
          `- video: ${video ? "present" : "unavailable"}`,
          "",
          "Outputs:",
          "- replay.json",
          "- manifest.json",
          "- screenshots/",
          "- state/",
          "- frames/",
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
    string: ["flow", "out-dir", "url", "browser"],
    boolean: ["serve"],
    default: {
      flow: FLOW_NAME,
      "out-dir": join(repoRoot, "exports"),
      url: "http://127.0.0.1:8000/webgl",
      browser: Deno.env.get("CHROMIUM_BIN") ?? "/usr/bin/chromium",
      serve: true,
    },
  });

  await runReview({
    flow: String(args.flow),
    url: String(args.url),
    outDir: String(args["out-dir"]),
    browserBin: String(args.browser),
    serve: Boolean(args.serve),
  });
}
