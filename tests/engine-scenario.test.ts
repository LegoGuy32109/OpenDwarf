import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  engineImportReplay,
  engineRunScenario,
  engineStepSimTick,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";

const FIXTURES = path.join("tests", "fixtures", "scenarios");
const GOLDENS_PATH = path.join(
  "tests",
  "goldens",
  "engine",
  "scenario_browser.json",
);

type ScenarioGoldenFile = Record<string, {
  drawHash: string;
  shell: { open: boolean; page: string };
}>;

async function loadScenario(name: string) {
  const raw = await readFile(path.join(FIXTURES, `${name}.json`), "utf8");
  return JSON.parse(raw) as unknown;
}

async function loadGoldens(): Promise<ScenarioGoldenFile> {
  try {
    const raw = await readFile(GOLDENS_PATH, "utf8");
    return JSON.parse(raw) as ScenarioGoldenFile;
  } catch {
    return {};
  }
}

async function blessGoldens(values: ScenarioGoldenFile) {
  await mkdir(path.dirname(GOLDENS_PATH), { recursive: true });
  await writeFile(GOLDENS_PATH, `${JSON.stringify(values, null, 2)}\n`);
}

test("runScenario shell smoke — thin Playwright + Scenario JSON", async ({ page }) => {
  const bless = !!process.env.ENGINE_SCENARIO_BROWSER_BLESS;
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");

  const scenario = await loadScenario("browser_shell_smoke");
  const result = await engineRunScenario(page, scenario);

  expect(result.name).toBe("browser_shell_smoke");
  expect(result.checkpoints.map((c) => c.name)).toEqual([
    "shell_root",
    "shell_settings",
  ]);

  const actual: ScenarioGoldenFile = {};
  for (const cp of result.checkpoints) {
    const shell = cp.snapshot.shell as { open: boolean; page: string };
    actual[cp.name] = {
      drawHash: cp.drawHash,
      shell: { open: shell.open, page: shell.page },
    };
  }

  expect(actual.shell_root?.shell).toEqual({ open: true, page: "root" });
  expect(actual.shell_settings?.shell).toEqual({ open: true, page: "settings" });

  if (bless) {
    await blessGoldens(actual);
  } else {
    const expected = await loadGoldens();
    for (const name of ["shell_root", "shell_settings"] as const) {
      expect(
        expected[name],
        `missing golden ${name}; run ENGINE_SCENARIO_BROWSER_BLESS=1`,
      ).toBeTruthy();
      expect(actual[name]).toEqual(expected[name]);
    }
  }
});

test("runScenario Engine step fail-closed (no partial run)", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");

  const scenario = await loadScenario("browser_engine_forbidden");
  const outcome = await page.evaluate(async (scenario) => {
    const harness =
      (globalThis as unknown as {
        __openDwarfEngineHarness?: {
          runScenario(s: unknown): Promise<unknown>;
          snapshot(): { shell: { open: boolean } };
        };
      }).__openDwarfEngineHarness!;
    try {
      await harness.runScenario(scenario);
      return { ok: true as const, shellOpen: harness.snapshot().shell.open };
    } catch (err) {
      return {
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
        shellOpen: harness.snapshot().shell.open,
      };
    }
  }, scenario);

  expect(outcome.ok).toBe(false);
  expect(outcome.message).toMatch(/fail-closed on Engine|engine_not_allowed/i);
  // No partial run — still at boot shell-closed.
  expect(outcome.shellOpen).toBe(false);
});

test("importReplay is explicit unimplemented (documents Stage B gap)", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);

  const result = await engineImportReplay(page, {
    metadata: { format_version: 1, name: "stub" },
  });
  expect(result.ok).toBe(false);
  expect(result.message).toMatch(/unimplemented/i);
  expect(result.message).toMatch(/importReplay/i);
});

test("stepSimTick is explicit unimplemented until wasm world", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);

  const result = await engineStepSimTick(page, 1);
  expect(result.ok).toBe(false);
  expect(result.message).toMatch(/unimplemented/i);
  expect(result.message).toMatch(/stepSimTick/i);
});
