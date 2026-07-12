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

const DEFAULT_WORLD_CONFIG = {
  chunk_edge: 16,
  world_chunks: { x: 1, y: 1, z: 1 },
  movement_ticks_per_tile: 10,
  terrain: {
    seed: "opendwarf",
    cave_frequency_xy: 0.15,
    cave_frequency_z: 0.01,
    cave_threshold: 0.11,
    cave_octaves: 4,
    cave_persistence: 0.58,
    cave_lacunarity: 2.0,
  },
};

const MOVE_WEST_HASH = "fnv1a64:8dad77ad6066915e";

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
  expect(actual.shell_settings?.shell).toEqual({
    open: true,
    page: "settings",
  });

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
    const harness = (globalThis as unknown as {
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

test("runScenario World movement changes primary entity and hash", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");

  const before = await page.evaluate(() =>
    (globalThis as unknown as {
      __openDwarfEngineHarness: { snapshot(): Record<string, unknown> };
    }).__openDwarfEngineHarness.snapshot()
  );
  const scenario = await loadScenario("browser_world_move");
  const result = await engineRunScenario(page, scenario);
  const after = result.finalSnapshot;

  const beforeWorld = before.world as {
    world_state_hash: string;
    primaryEntity: { position: { x: number; y: number; z: number } };
  };
  const afterWorld = after.world as {
    tick: number;
    world_state_hash: string;
    primaryEntity: { position: { x: number; y: number; z: number } };
  };

  expect(result.checkpoints.map((c) => c.name)).toEqual(["after_move"]);
  expect(afterWorld.tick).toBe(10);
  expect(afterWorld.world_state_hash).toBe(MOVE_WEST_HASH);
  expect(afterWorld.world_state_hash).not.toBe(beforeWorld.world_state_hash);
  expect(afterWorld.primaryEntity.position).not.toEqual(
    beforeWorld.primaryEntity.position,
  );
});

test("importReplay replays WorldReplay JSON into wasm WorldSim", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);

  const replay = {
    metadata: {
      format_version: 1,
      name: "browser_import_move_west",
      world_config: DEFAULT_WORLD_CONFIG,
      spawn_default_player: true,
    },
    events: [
      {
        Command: {
          tick_before: 0,
          command: {
            MoveEntity: {
              id: 1,
              direction: { x: -1, y: 0, z: 0 },
            },
          },
        },
      },
      {
        Command: {
          tick_before: 0,
          command: {
            AdvanceTicks: { count: 10 },
          },
        },
      },
    ],
    final_snapshot: {
      tick: 0,
      chunk_edge: 16,
      world_chunks: { x: 1, y: 1, z: 1 },
      terrain_blocks: {},
      loaded_chunks: [],
      entities: [],
    },
    final_state_hash: MOVE_WEST_HASH,
  };
  const result = await engineImportReplay(page, replay);
  expect(result.ok, result.ok ? "" : result.message).toBe(true);
  const snapshot = result.snapshot as Record<string, unknown>;
  const world = snapshot.world as { tick: number; world_state_hash: string };
  expect(world.tick).toBe(10);
  expect(world.world_state_hash).toBe(MOVE_WEST_HASH);
});

test("stepSimTick advances the real wasm WorldSim clock", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);

  const result = await engineStepSimTick(page, 2);
  expect(result.ok).toBe(true);
  const snapshot = await page.evaluate(() =>
    (globalThis as unknown as {
      __openDwarfEngineHarness: {
        snapshot(): { world: { tick: number } };
      };
    }).__openDwarfEngineHarness.snapshot()
  );
  expect(snapshot.world.tick).toBe(2);
});
