import type { Page } from "@playwright/test";
import type {
  FlowDescriptor,
  PerfWindow,
} from "../../lib/webgl-harness-types.ts";

export type { FlowDescriptor, PerfWindow };

export type HarnessCheckpoint = {
  name: string;
  ordinal: number;
  tick: number;
  frame: number;
  screenshotFilename: string;
  stateFilename: string;
  stateHash: string;
  baselineConfigured: boolean;
  baselineSource: string | null;
  perf: PerfWindow;
  visibleChunks: string[];
  residentChunks: number;
};

type BrowserHarness = {
  loadFlow(d: FlowDescriptor): void;
  stepTick(n: number): Promise<void>;
  captureCheckpoint(name: string): Promise<HarnessCheckpoint | null>;
  setCamera(x: number, y: number, zoom: number): Promise<void>;
  setCameraSpeed(pxPerS: number): void;
  exportReplay(): { events: { type: string }[] };
  exportBundleData(): Promise<{
    replayJson: string;
    manifestJson: string;
    screenshots: { filename: string; dataUrl: string }[];
    states: { filename: string; dataUrl: string }[];
  }>;
};

type BrowserGlobal = { __openDwarfWebGlHarness?: BrowserHarness };

export async function waitForHarness(page: Page, timeout = 15_000) {
  await page.waitForFunction(
    () => !!(self as unknown as BrowserGlobal).__openDwarfWebGlHarness,
    { timeout },
  );
  await page.evaluate(() => {
    const shell = document.querySelector(".webgl-experiment-shell");
    return shell?.requestFullscreen({ navigationUI: "hide" });
  });
  await page.waitForFunction(
    () => document.fullscreenElement !== null,
    { timeout: 5_000 },
  );
}

export function loadFlow(page: Page, descriptor: FlowDescriptor) {
  return page.evaluate((d) => {
    (self as unknown as BrowserGlobal).__openDwarfWebGlHarness!.loadFlow(d);
  }, descriptor);
}

export function stepTick(page: Page, n: number) {
  return page.evaluate((n) => {
    return (self as unknown as BrowserGlobal).__openDwarfWebGlHarness!.stepTick(
      n,
    );
  }, n);
}

export function captureCheckpoint(
  page: Page,
  name: string,
): Promise<HarnessCheckpoint | null> {
  return page.evaluate((name) => {
    return (self as unknown as BrowserGlobal)
      .__openDwarfWebGlHarness!.captureCheckpoint(name);
  }, name);
}

export function setCamera(page: Page, x: number, y: number, zoom = 1) {
  return page.evaluate(
    ([x, y, zoom]) => {
      return (self as unknown as BrowserGlobal)
        .__openDwarfWebGlHarness!.setCamera(x, y, zoom);
    },
    [x, y, zoom] as [number, number, number],
  );
}

export function setCameraSpeed(page: Page, pxPerS: number) {
  return page.evaluate((pxPerS) => {
    (self as unknown as BrowserGlobal)
      .__openDwarfWebGlHarness!.setCameraSpeed(pxPerS);
  }, pxPerS);
}

export function waitForEvent(page: Page, type: string, timeout = 15_000) {
  return page.waitForFunction(
    (type) => {
      const h = (self as unknown as BrowserGlobal).__openDwarfWebGlHarness;
      return h?.exportReplay().events.some((e) => e.type === type) ?? false;
    },
    type,
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// Canvas recording — bypasses Playwright's JPEG screencasting pipeline and
// records straight from the WebGL framebuffer via captureStream + MediaRecorder.
// ---------------------------------------------------------------------------

export async function startCanvasRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    if (!canvas) throw new Error("canvas not found");
    const stream = canvas.captureStream(60);
    const mimeType = "video/webm;codecs=vp9";
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported(mimeType)
        ? mimeType
        : "video/webm",
      videoBitsPerSecond: 16_000_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    (self as unknown as Record<string, unknown>)["__canvasRecorder"] = recorder;
    (self as unknown as Record<string, unknown>)["__canvasChunks"] = chunks;
    recorder.start();
  });
}

export async function stopAndSaveCanvasRecording(
  page: Page,
  outputPath: string,
): Promise<void> {
  const b64 = await page.evaluate((): Promise<string> => {
    return new Promise((resolve) => {
      const g = self as unknown as Record<string, unknown>;
      const recorder = g["__canvasRecorder"] as MediaRecorder;
      const chunks = g["__canvasChunks"] as BlobPart[];
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(blob);
      };
      recorder.stop();
    });
  });

  const fs = await import("node:fs");
  const path = await import("node:path");
  const { Buffer } = await import("node:buffer");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(b64, "base64"));
}
