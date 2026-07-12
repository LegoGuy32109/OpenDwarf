import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "npm:playwright@1.52.0";

import { chromiumLaunchArgs } from "../tests/helpers/chromium.ts";

const baseUrl = "http://127.0.0.1:8000";
const routes = ["/webgl", "/engine"];

function percentile(samples: number[], fraction: number) {
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[
    Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))
  ]!;
}

async function healthyServer() {
  try {
    return (await fetch(baseUrl)).ok;
  } catch {
    return false;
  }
}

let child: Deno.ChildProcess | undefined;
if (!await healthyServer()) {
  child = new Deno.Command("deno", {
    args: ["run", "-A", "dev.ts"],
    stdout: "null",
    stderr: "piped",
  }).spawn();
  const deadline = Date.now() + 30_000;
  while (!(await healthyServer())) {
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for dev server");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

try {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: chromiumLaunchArgs,
  });
  const results: Record<string, unknown> = {};
  for (const route of routes) {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const failures: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(message.text());
    });
    page.on("pageerror", (error) => failures.push(error.message));
    await page.addInitScript(() => {
      type RafWindow = {
        requestAnimationFrame: (callback: (time: number) => void) => number;
        __odRafDurations?: number[];
      };
      const win = globalThis as unknown as RafWindow;
      const original = win.requestAnimationFrame.bind(win);
      win.__odRafDurations = [];
      win.requestAnimationFrame = (callback: (time: number) => void) =>
        original((time) => {
          const start = performance.now();
          callback(time);
          win.__odRafDurations!.push(performance.now() - start);
        });
    });
    await page.goto(`${baseUrl}${route}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForFunction(
      () =>
        (globalThis as unknown as { __odRafDurations?: number[] })
          .__odRafDurations?.length! >= 25,
      undefined,
      { timeout: 30_000 },
    );
    if (failures.length) {
      throw new Error(`${route} browser errors: ${failures.join("; ")}`);
    }
    const samples = await page.evaluate(() =>
      (globalThis as unknown as { __odRafDurations?: number[] })
        .__odRafDurations!.slice(-20)
    );
    const renderer = await page.evaluate(() => {
      const doc = (globalThis as unknown as {
        document: {
          createElement: (tag: string) => {
            getContext: (kind: string) => {
              getParameter: (parameter: number) => unknown;
              RENDERER: number;
            } | null;
          };
        };
      }).document;
      const gl = doc.createElement("canvas").getContext("webgl2");
      return gl?.getParameter(gl.RENDERER) ?? "unavailable";
    });
    results[route] = {
      samples,
      medianMs: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      renderer,
    };
    await page.close();
  }
  await browser.close();
  const output = {
    recordedAt: new Date().toISOString(),
    chromium: await new Deno.Command("/usr/bin/chromium", {
      args: ["--version"],
      stdout: "piped",
    }).output().then((out) => new TextDecoder().decode(out.stdout).trim()),
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    wasmProfile: "production static/game_engine artifacts served by dev.ts",
    results,
  };
  await mkdir("exports/engine-perf", { recursive: true });
  const path = `exports/engine-perf/${
    new Date().toISOString().replace(/[:.]/g, "-")
  }.json`;
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${path}`);
} finally {
  if (child) {
    child.kill("SIGTERM");
    await child.status;
  }
}
