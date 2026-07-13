import { mkdir, writeFile } from "node:fs/promises";
import {
  type Browser,
  chromium,
  type Page,
  type Response,
} from "npm:playwright@1.52.0";

import { chromiumLaunchArgs } from "../tests/helpers/chromium.ts";
import {
  readEngineWasmBuildMetadata,
  sha256,
} from "../tests/helpers/wasm-provenance.ts";

const baseUrl = "http://127.0.0.1:8000";
const routes = ["/webgl", "/engine"] as const;
const engineWasmSuffix = "/engine/generated/od_wasm_bg.wasm";

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

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (!await healthyServer()) {
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for dev server");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function inspectApplicationGl(page: Page, canvasId: string) {
  return await page.evaluate((id) => {
    const doc = (globalThis as unknown as {
      document: {
        getElementById: (id: string) => {
          getContext: (kind: string) => {
            getExtension: (
              name: string,
            ) => {
              UNMASKED_VENDOR_WEBGL: number;
              UNMASKED_RENDERER_WEBGL: number;
            } | null;
            getParameter: (parameter: number) => unknown;
            getError: () => number;
            NO_ERROR: number;
            VENDOR: number;
            RENDERER: number;
            isContextLost: () => boolean;
          } | null;
        } | null;
      };
    }).document;
    const canvas = doc.getElementById(id);
    const gl = canvas?.getContext("webgl2");
    if (!canvas || !gl) {
      throw new Error(`application WebGL2 context unavailable: #${id}`);
    }
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = debug
      ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR);
    const renderer = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const errors: number[] = [];
    for (
      let error = gl.getError();
      error !== gl.NO_ERROR;
      error = gl.getError()
    ) errors.push(error);
    return {
      canvasId: id,
      contextLost: gl.isContextLost(),
      vendor: String(vendor),
      renderer: String(renderer),
      rendererSource: debug ? "WEBGL_debug_renderer_info" : "standard",
      errors,
    };
  }, canvasId);
}

let child: Deno.ChildProcess | undefined;
let browser: Browser | undefined;
try {
  if (!await healthyServer()) {
    // Isolate the server in its own process group: dev.ts starts Vite, so
    // terminating only its parent would otherwise leak the grandchild.
    child = new Deno.Command("setsid", {
      args: ["deno", "run", "-A", "dev.ts"],
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    await waitForServer();
  }

  const metadata = await readEngineWasmBuildMetadata();
  if (metadata.profile !== "release") {
    throw new Error(
      `performance profile requires release wasm, got ${metadata.profile}`,
    );
  }
  browser = await chromium.launch({
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
    try {
      const failures: string[] = [];
      let wasmResponse: Response | undefined;
      page.on("console", (message) => {
        if (message.type() === "error") failures.push(message.text());
      });
      page.on("pageerror", (error) => failures.push(error.message));
      page.on("response", (response) => {
        if (response.url().includes(engineWasmSuffix)) wasmResponse = response;
      });
      await page.addInitScript(() => {
        const win = globalThis as unknown as {
          requestAnimationFrame: (callback: (time: number) => void) => number;
          __odRafDurations?: number[];
        };
        const original = win.requestAnimationFrame.bind(win);
        win.__odRafDurations = [];
        win.requestAnimationFrame = (callback) =>
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
      const gl = await inspectApplicationGl(
        page,
        route === "/engine" ? "engine-canvas" : "webgl2-canvas",
      );
      if (gl.contextLost || gl.errors.length) {
        throw new Error(`${route} WebGL unhealthy: ${JSON.stringify(gl)}`);
      }
      const provenance = route === "/engine"
        ? await (async () => {
          if (!wasmResponse) {
            throw new Error("did not observe the engine wasm response");
          }
          const observedSha256 = sha256(await wasmResponse.body());
          if (observedSha256 !== metadata.wasm.sha256) {
            throw new Error(
              `served wasm hash ${observedSha256} does not match metadata ${metadata.wasm.sha256}`,
            );
          }
          return {
            metadata,
            served: { url: wasmResponse.url(), sha256: observedSha256 },
          };
        })()
        : undefined;
      results[route] = {
        samples,
        medianMs: percentile(samples, 0.5),
        p95Ms: percentile(samples, 0.95),
        gl,
        provenance,
      };
    } finally {
      await page.close();
    }
  }

  const chromiumVersion = await new Deno.Command("/usr/bin/chromium", {
    args: ["--version"],
    stdout: "piped",
  }).output();
  const output = {
    recordedAt: new Date().toISOString(),
    chromium: new TextDecoder().decode(chromiumVersion.stdout).trim(),
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    results,
  };
  await mkdir("exports/engine-perf", { recursive: true });
  const path = `exports/engine-perf/${
    new Date().toISOString().replace(/[:.]/g, "-")
  }.json`;
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${path}`);
} finally {
  await browser?.close();
  if (child) {
    await new Deno.Command("bash", {
      // Bash's kill builtin supports a negative process-group id reliably
      // across the minimal images used by the browser harness.
      args: ["-c", 'kill -TERM -- -"$1"', "bash", String(child.pid)],
      stdout: "null",
      stderr: "null",
    }).output();
    await child.status;
  }
}
