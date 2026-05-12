import type { Page } from "npm:@playwright/test@1.52.0";
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
};

type BrowserHarness = {
  loadFlow(d: FlowDescriptor): void;
  stepTick(n: number): Promise<void>;
  captureCheckpoint(name: string): Promise<HarnessCheckpoint | null>;
  setCamera(x: number, y: number, zoom: number): Promise<void>;
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
