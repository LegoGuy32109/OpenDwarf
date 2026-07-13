import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  allowlistFromSnapshot,
  captureEngineCheckpoint,
  enginePress,
  type EngineSnapshot,
  engineTypeText,
  exportEngineBundle,
  stepEngineFrame,
  waitForEngineHarness,
  writeEngineGoldenArtifacts,
} from "./helpers/engine-harness.ts";

const CHECKPOINTS = [
  "boot_idle",
  "chat_open_empty",
  "chat_typed",
  "chat_submitted",
  "shell_root",
  "shell_settings",
  "shell_settings_scale",
] as const;

const GOLDENS_PATH = path.join(
  "tests",
  "goldens",
  "engine",
  "checkpoints.json",
);

type GoldenEntry = {
  drawHash: string;
  shell: { open: boolean; page: string };
  session: {
    uiMode: string;
    chatDraft: string;
    chatMessages: string[];
  };
  input: { textCaptureActive: boolean };
};

type GoldenFile = Record<string, GoldenEntry>;

async function loadGoldens(): Promise<GoldenFile> {
  try {
    const raw = await readFile(GOLDENS_PATH, "utf8");
    return JSON.parse(raw) as GoldenFile;
  } catch {
    return {};
  }
}

async function blessGoldens(values: GoldenFile) {
  await mkdir(path.dirname(GOLDENS_PATH), { recursive: true });
  await writeFile(GOLDENS_PATH, `${JSON.stringify(values, null, 2)}\n`);
}

test("engine golden path — seven checkpoints", async ({ page }) => {
  const bless = !!process.env.ENGINE_GOLDEN_BLESS;
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");

  const actual: GoldenFile = {};

  await stepEngineFrame(page, 1);
  let checkpoint = await captureEngineCheckpoint(page, "boot_idle", {
    screenshot: true,
  });
  actual.boot_idle = allowlistFromSnapshot(
    checkpoint.snapshot as EngineSnapshot,
  ) as GoldenEntry;

  await enginePress(page, "KeyT");
  await stepEngineFrame(page, 1);
  checkpoint = await captureEngineCheckpoint(page, "chat_open_empty", {
    screenshot: true,
  });
  actual.chat_open_empty = allowlistFromSnapshot(
    checkpoint.snapshot as EngineSnapshot,
  ) as GoldenEntry;

  await engineTypeText(page, "hello");
  await stepEngineFrame(page, 1);
  checkpoint = await captureEngineCheckpoint(page, "chat_typed", {
    screenshot: true,
  });
  actual.chat_typed = allowlistFromSnapshot(
    checkpoint.snapshot as EngineSnapshot,
  ) as GoldenEntry;

  await enginePress(page, "Enter");
  await stepEngineFrame(page, 1);
  checkpoint = await captureEngineCheckpoint(page, "chat_submitted", {
    screenshot: true,
  });
  actual.chat_submitted = allowlistFromSnapshot(
    checkpoint.snapshot as EngineSnapshot,
  ) as GoldenEntry;

  await enginePress(page, "Escape");
  await stepEngineFrame(page, 1);
  checkpoint = await captureEngineCheckpoint(page, "shell_root", {
    screenshot: true,
  });
  actual.shell_root = allowlistFromSnapshot(
    checkpoint.snapshot as EngineSnapshot,
  ) as GoldenEntry;

  await enginePress(page, "KeyK");
  await stepEngineFrame(page, 1);
  await enginePress(page, "Enter");
  await stepEngineFrame(page, 1);
  checkpoint = await captureEngineCheckpoint(page, "shell_settings", {
    screenshot: true,
  });
  actual.shell_settings = allowlistFromSnapshot(
    checkpoint.snapshot as EngineSnapshot,
  ) as GoldenEntry;

  await enginePress(page, "KeyK");
  await stepEngineFrame(page, 1);
  await enginePress(page, "Enter");
  await stepEngineFrame(page, 1);
  checkpoint = await captureEngineCheckpoint(page, "shell_settings_scale", {
    screenshot: true,
  });
  actual.shell_settings_scale = allowlistFromSnapshot(
    checkpoint.snapshot as EngineSnapshot,
  ) as GoldenEntry;

  const bundle = await exportEngineBundle(page);
  await writeEngineGoldenArtifacts(bundle, { copyCloud: true });

  if (bless) {
    await blessGoldens(actual);
  } else {
    const expected = await loadGoldens();
    for (const name of CHECKPOINTS) {
      const want = expected[name];
      expect(
        want,
        `missing golden for ${name}; run deno task engine:bless-goldens-browser`,
      ).toBeTruthy();
      expect(actual[name], name).toEqual(want);
    }
  }
});
