import type { Page } from "@playwright/test";

type EngineSnapshot = {
  version: 1;
  frame: {
    number: number;
    drawCount: number;
    droppedRects: number;
    droppedGlyphs: number;
    droppedDrawCmds: number;
  };
  shell: {
    open: boolean;
    page: "root" | "settings";
  };
  session: {
    uiMode: "world" | "chat";
    chatDraft: string;
    chatCaret: number;
    chatMessages: string[];
  };
  input: {
    canvasFocused: boolean;
    textCaptureActive: boolean;
    hiddenInputFocused: boolean;
  };
  render: {
    framebufferWidth: number;
    framebufferHeight: number;
  };
};

type BrowserGlobal = {
  __openDwarfEngineHarness?: {
    version: 1;
    input: {
      press(code: string, modifiers?: number): Promise<void>;
      typeText(text: string): Promise<void>;
      paste(text: string): Promise<void>;
    };
    stepFrame(n?: number): Promise<void>;
    snapshot(): EngineSnapshot;
  };
};

export async function waitForEngineHarness(page: Page, timeout = 15_000) {
  await page.waitForFunction(
    () => !!(globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness,
    { timeout },
  );
}

export function engineSnapshot(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.snapshot()
  );
}

export function enginePress(page: Page, code: string, modifiers?: number) {
  return page.evaluate(
    ([code, modifiers]) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
        .press(code, modifiers),
    [code, modifiers] as [string, number | undefined],
  );
}

export function engineTypeText(page: Page, text: string) {
  return page.evaluate((text) =>
    (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
      .typeText(text)
  , text);
}

export function enginePaste(page: Page, text: string) {
  return page.evaluate((text) =>
    (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
      .paste(text)
  , text);
}

export function stepEngineFrame(page: Page, n = 1) {
  return page.evaluate((n) =>
    (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.stepFrame(
      n,
    )
  , n);
}
