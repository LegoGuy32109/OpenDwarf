import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  engineImportReplay,
  engineKeyDown,
  engineKeyUp,
  enginePress,
  engineResetWorld,
  engineSnapshot,
  engineStepSimTick,
  engineTypeText,
  mvpAllowlistFromSnapshot,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";

const GOLDENS_PATH = path.join(
  "tests",
  "goldens",
  "engine",
  "mvp_checkpoints.json",
);

const CHECKPOINTS = [
  "boot_entity",
  "fov_stable_second_frame",
  "view_z_up",
  "view_z_restored",
  "view_zoom_in",
  "master_mode",
  "after_move_west",
  "master_keeps_memory",
  "entity_restores_fov",
  "play_projection",
  "diagonal_sw_start",
  "chat_sim_advances",
  "import_move_west",
] as const;

type MvpGoldenEntry = ReturnType<typeof mvpAllowlistFromSnapshot>;
type MvpGoldenFile = Record<string, MvpGoldenEntry>;

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

async function loadGoldens(): Promise<MvpGoldenFile> {
  try {
    const raw = await readFile(GOLDENS_PATH, "utf8");
    return JSON.parse(raw) as MvpGoldenFile;
  } catch {
    return {};
  }
}

async function blessGoldens(values: MvpGoldenFile) {
  await mkdir(path.dirname(GOLDENS_PATH), { recursive: true });
  await writeFile(GOLDENS_PATH, `${JSON.stringify(values, null, 2)}\n`);
}

async function submitSlash(
  page: Parameters<typeof enginePress>[0],
  command: string,
) {
  await enginePress(page, "Slash");
  await stepEngineFrame(page, 1);
  await engineTypeText(page, command.slice(1));
  await stepEngineFrame(page, 1);
  await enginePress(page, "Enter");
  await stepEngineFrame(page, 2);
}

test("engine MVP golden path — world/view/render checkpoints", async ({ page }) => {
  const bless = !!process.env.ENGINE_MVP_GOLDEN_BLESS;
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");

  const actual: MvpGoldenFile = {};

  await stepEngineFrame(page, 1);
  actual.boot_entity = mvpAllowlistFromSnapshot(await engineSnapshot(page));

  await stepEngineFrame(page, 1);
  actual.fov_stable_second_frame = mvpAllowlistFromSnapshot(
    await engineSnapshot(page),
  );

  await enginePress(page, "KeyR");
  await stepEngineFrame(page, 1);
  actual.view_z_up = mvpAllowlistFromSnapshot(await engineSnapshot(page));

  await enginePress(page, "KeyV");
  await stepEngineFrame(page, 1);
  actual.view_z_restored = mvpAllowlistFromSnapshot(await engineSnapshot(page));

  await enginePress(page, "KeyM");
  await stepEngineFrame(page, 1);
  actual.view_zoom_in = mvpAllowlistFromSnapshot(await engineSnapshot(page));

  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  await submitSlash(page, "/master");
  actual.master_mode = mvpAllowlistFromSnapshot(await engineSnapshot(page));

  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  await engineKeyDown(page, "KeyS");
  for (let i = 0; i < 16; i++) {
    await engineStepSimTick(page, 1);
  }
  await engineKeyUp(page, "KeyS");
  await stepEngineFrame(page, 1);
  actual.after_move_west = mvpAllowlistFromSnapshot(await engineSnapshot(page));

  await submitSlash(page, "/master");
  actual.master_keeps_memory = mvpAllowlistFromSnapshot(
    await engineSnapshot(page),
  );

  await submitSlash(page, "/entity");
  actual.entity_restores_fov = mvpAllowlistFromSnapshot(
    await engineSnapshot(page),
  );

  await engineResetWorld(page, "play");
  // Four 16 ms frames advance one fixed tick, trimming the lifecycle
  // projection back to the local window.
  await stepEngineFrame(page, 4);
  actual.play_projection = mvpAllowlistFromSnapshot(await engineSnapshot(page));

  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  await engineKeyDown(page, "KeyD");
  await engineKeyDown(page, "KeyS");
  await engineStepSimTick(page, 1);
  actual.diagonal_sw_start = mvpAllowlistFromSnapshot(
    await engineSnapshot(page),
  );
  await engineKeyUp(page, "KeyS");
  await engineKeyUp(page, "KeyD");

  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  await enginePress(page, "KeyT");
  await stepEngineFrame(page, 1);
  const chatBefore = await engineSnapshot(page);
  await stepEngineFrame(page, 4);
  const chatAfter = await engineSnapshot(page);
  expect(chatBefore.session.uiMode).toBe("chat");
  expect(chatAfter.session.uiMode).toBe("chat");
  expect(chatAfter.world.tick).toBeGreaterThan(chatBefore.world.tick);
  actual.chat_sim_advances = mvpAllowlistFromSnapshot(chatAfter);

  const replay = {
    metadata: {
      format_version: 1,
      name: "mvp_import_move_west",
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
  const imported = await engineImportReplay(page, replay);
  expect(imported.ok, imported.ok ? "" : imported.message).toBe(true);
  await stepEngineFrame(page, 1);
  actual.import_move_west = mvpAllowlistFromSnapshot(
    await engineSnapshot(page),
  );
  expect(actual.import_move_west.world.world_state_hash).toBe(MOVE_WEST_HASH);

  // Hard MVP invariants (even during bless).
  expect(actual.boot_entity.worldRender.floorQuadCount).toBeGreaterThan(0);
  expect(actual.boot_entity.worldRender.playerQuadCount).toBe(1);
  expect(actual.boot_entity.localWorldView.viewMode).toBe("entity");
  expect(actual.fov_stable_second_frame.worldRender.fovRecomputeCount).toBe(
    actual.boot_entity.worldRender.fovRecomputeCount,
  );
  expect(actual.view_z_up.localWorldView.viewZ).toBe(
    actual.boot_entity.localWorldView.viewZ + 1,
  );
  expect(actual.view_zoom_in.localWorldView.zoom).toBe(1.5);
  expect(actual.master_mode.localWorldView.viewMode).toBe("master");
  expect(actual.after_move_west.world.primaryEntity?.position).not.toEqual(
    actual.boot_entity.world.primaryEntity?.position,
  );
  expect(actual.after_move_west.worldRender.rememberedTileCount)
    .toBeGreaterThan(
      0,
    );
  expect(actual.master_keeps_memory.worldRender.rememberedTileCount).toBe(
    actual.after_move_west.worldRender.rememberedTileCount,
  );
  expect(actual.master_keeps_memory.worldRender.visibleTileCount).toBe(0);
  expect(actual.entity_restores_fov.localWorldView.viewMode).toBe("entity");
  expect(actual.entity_restores_fov.worldRender.visibleTileCount)
    .toBeGreaterThan(
      0,
    );
  const playTotal = actual.play_projection.world.worldChunks.x *
    actual.play_projection.world.worldChunks.y *
    actual.play_projection.world.worldChunks.z;
  // Stage 4: every generated chunk stays simulation-resident; the camera
  // controls only the local projection window.
  expect(actual.play_projection.world.loadedChunkCount).toBe(playTotal);
  expect(actual.play_projection.localWorldView.projectedChunkCount)
    .toBeGreaterThan(0);
  expect(actual.play_projection.localWorldView.projectedChunkCount)
    .toBeLessThan(playTotal);
  expect(actual.diagonal_sw_start.world.primaryEntity?.moving).toBe(true);
  expect(actual.diagonal_sw_start.world.primaryEntity?.movementTarget).toEqual({
    x: -5,
    y: 1,
    z: 1,
  });
  expect(actual.chat_sim_advances.session.uiMode).toBe("chat");
  expect(actual.import_move_west.world.tick).toBe(10);

  if (bless) {
    await blessGoldens(actual);
  } else {
    const expected = await loadGoldens();
    for (const name of CHECKPOINTS) {
      expect(
        expected[name],
        `missing MVP golden ${name}; run ENGINE_MVP_GOLDEN_BLESS=1`,
      ).toBeTruthy();
      expect(actual[name], name).toEqual(expected[name]);
    }
  }
});
