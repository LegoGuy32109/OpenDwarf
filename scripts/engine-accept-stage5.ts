import { runStageAcceptance } from "./lib/engine-accept-stage.ts";

const STAGE_4_PERF_EVIDENCE =
  "docs/design/checkpoints/evidence/engine-render-hot-path-stage-4-perf.json";
// Stage 5 records 133 passing Rust workspace tests (FOV bitmap parity,
// perspective memory persistence, tick-exit scheduling, master-mode
// clear/preserve, and per-column revision coverage); a decrease below this
// floor is a red gate.
const STAGE_5_RUST_PASSED_FLOOR = 133;
// Stage 3 world-layer parity reference over only the world DrawCmd prefix
// plus world arenas. The Stage 5 bitmap-perspective renderer must reproduce
// this exact value; any difference is a stop condition, never a re-bless
// ("draw hash unchanged from Stage 4").
const STAGE_5_WORLD_DRAW_HASH = "fnv1a64:c55ac880b00ac4d0";
// Stage 4 all-resident play-world state hash; Stage 5 changes no
// authoritative state, so it must hold exactly.
const STAGE_5_WORLD_STATE_HASH = "fnv1a64:718bb0099657e9aa";
// Stage 5 tightens the 20-frame median ceiling from Stage 4's 400 ms to
// 250 ms.
const STAGE_5_CEILING_MS = 250;

// The mvp golden `play_projection` path pins the tick-exit FOV scheduler:
// exactly two recomputes (boot projection + the projection trim tick) with
// the golden file itself proven unchanged by the no-golden-change manifest.
const MVP_GOLDEN_PATH = "tests/goldens/engine/mvp_checkpoints.json";
const MVP_FOV_RECOMPUTE_CHECKPOINT = "play_projection";
const MVP_FOV_RECOMPUTE_COUNT = 2;

// Stage 5 owned FOV recompute timing distribution: informational evidence
// required by the plan ("record FOV-recompute sample distribution; do not
// gate CI on a brittle 1 ms single measurement"). Recorded, not gated.
const FOV_RECOMPUTE_DISTRIBUTION = {
  scenario:
    "9x9x1 play-world walk; 40 origin-changing fixed ticks, one recompute each",
  sampleCount: 40,
  release: { medianUs: 468, p95Us: 823 },
  debug: { medianMs: 4.24, p95Ms: 7.34 },
  ciGate: "none per plan; timing is recorded evidence only",
  enforcedBy:
    "od_world project::tests::fov_recompute_timing_distribution_is_recorded",
};

// Named tests enforcing the Stage 5 contracts that Stage 6 consumes ("FOV
// bitmap parity, dirty scheduling, and memory persistence"). Later stages may
// strengthen these but may not silently delete, skip, or weaken them.
const STAGE_5_CONTRACT_TESTS = {
  legacySetVsBitmapParity: [
    "od_world project::tests::fov_bitmap_matches_legacy_sets_in_default_world",
    "od_world project::tests::fov_bitmap_matches_legacy_sets_across_chunk_boundaries",
    "od_world project::tests::fov_bitmap_matches_legacy_sets_with_negative_chunks_and_missing_chunks",
  ],
  memoryStreamOutInSurvival: [
    "od_world project::tests::perspective_memory_survives_projection_stream_out_and_in",
  ],
  idleNoRecompute: [
    "od_wasm tests::idle_frames_never_recompute_fov",
  ],
  oneRecomputePerOriginChangingTick: [
    "od_wasm tests::origin_changing_tick_recomputes_exactly_once",
  ],
  masterModeClearPreserve: [
    "od_wasm tests::master_tick_clears_visible_preserves_memory_and_entity_restores",
    "od_world render::tests::master_mode_preserves_entity_fov_memory",
  ],
  perColumnRevisionBumps: [
    "od_world project::tests::column_revisions_bump_only_for_changed_columns",
    "od_world project::tests::column_revisions_bump_for_block_mutation_in_view",
  ],
};

// Gate the mvp golden scheduler pin before spending any acceptance work: the
// golden must already record exactly two recomputes on the play_projection
// path (Stage 4 blessed 1 -> 2; Stage 5 authorizes no golden change).
const mvpGolden = JSON.parse(await Deno.readTextFile(MVP_GOLDEN_PATH));
const mvpFovRecomputeCount = mvpGolden[MVP_FOV_RECOMPUTE_CHECKPOINT]
  ?.worldRender?.fovRecomputeCount;
if (mvpFovRecomputeCount !== MVP_FOV_RECOMPUTE_COUNT) {
  throw new Error(
    `${MVP_GOLDEN_PATH} ${MVP_FOV_RECOMPUTE_CHECKPOINT}.worldRender.fovRecomputeCount is ${
      JSON.stringify(mvpFovRecomputeCount)
    }, required ${MVP_FOV_RECOMPUTE_COUNT}`,
  );
}
console.log(
  `mvp golden ${MVP_FOV_RECOMPUTE_CHECKPOINT}.worldRender.fovRecomputeCount == ${MVP_FOV_RECOMPUTE_COUNT}`,
);

await runStageAcceptance({
  stage: 5,
  rustPassedFloor: { label: "Stage 5", passed: STAGE_5_RUST_PASSED_FLOOR },
  baselinePerf: { label: "Stage 4", evidencePath: STAGE_4_PERF_EVIDENCE },
  // Zero WorldSim::snapshot() calls on every recorded frame path, unchanged
  // across the same ten Stage 4 paths.
  expectedSnapshotCallsPerPath: 0,
  requiredCeilingMs: STAGE_5_CEILING_MS,
  requiredSemantics: {
    // Render consumes immutable &EntityPerspective; no snapshots.
    snapshotCallsLastFrame: 0,
    // Bitmap perspective and tick-exit FOV change no draw output: the Stage 3
    // world-layer parity hash holds exactly through Stage 5.
    worldDrawHash: STAGE_5_WORLD_DRAW_HASH,
    // No authoritative state change: the Stage 4 all-resident hash holds.
    worldStateHash: STAGE_5_WORLD_STATE_HASH,
    worldTick: 33,
    drawCount: 7,
    floorQuadCount: 130,
    playerQuadCount: 1,
    atlasQuadCount: 131,
    // Bounded lag handling must not discard simulated time at the
    // deterministic 16 ms harness pacing used by the release perf run.
    droppedSimTimeMs: 0,
  },
  // Stage 5 authorizes no golden changes ("unchanged from Stage 4").
  goldensReason:
    "Stage 5 authorizes no golden changes; bitmap perspective and tick-exit FOV are draw-output-neutral, proven by the exact worldDrawHash gate, and no golden file was changed or blessed.",
  buildStageOwned: ({ rustCounts, perf, baselinePerf, snapshotCalls }) => ({
    snapshotMatrix: {
      requiredCallsPerPath: 0,
      recorded: snapshotCalls,
    },
    rustWorkspaceTests: {
      passed: rustCounts.passed,
      failed: rustCounts.failed,
      passedFloor: STAGE_5_RUST_PASSED_FLOOR,
    },
    perfMedianVsStage4: {
      stage4EvidencePath: baselinePerf.evidencePath,
      stage4MedianMs: baselinePerf.medianMs,
      medianMs: perf.medianMs,
    },
    worldDrawHash: {
      required: STAGE_5_WORLD_DRAW_HASH,
      recorded: perf.semantics.worldDrawHash,
      role:
        "Stage 3 world-layer parity reference held exactly through the bitmap-perspective/tick-exit-FOV cutover",
    },
    worldStateHash: {
      required: STAGE_5_WORLD_STATE_HASH,
      recorded: perf.semantics.worldStateHash,
      role:
        "Stage 4 all-resident play-world hash; Stage 5 changes no authoritative state",
    },
    droppedSimTimeMs: perf.semantics.droppedSimTimeMs,
    fovRecomputeDistribution: FOV_RECOMPUTE_DISTRIBUTION,
    mvpFovRecomputeCount: {
      goldenPath: MVP_GOLDEN_PATH,
      checkpoint: MVP_FOV_RECOMPUTE_CHECKPOINT,
      field: "worldRender.fovRecomputeCount",
      required: MVP_FOV_RECOMPUTE_COUNT,
      recorded: mvpFovRecomputeCount,
      role:
        "tick-exit FOV scheduler pin: boot projection plus the projection trim tick, with the golden proven unchanged",
    },
    stage5ContractTests: STAGE_5_CONTRACT_TESTS,
    perfFixtureCeiling: {
      file: "tests/engine-perf.test.ts",
      ceilingMs: { before: 400, after: STAGE_5_CEILING_MS },
      reason:
        "authorized Stage 5 tightening of the release perf 20-frame median ceiling",
    },
  }),
  residualRisks: [
    "Stage 5 still renders entity positions from the tick-final ClientView without alpha interpolation; Stage 6 must populate prev_xy/curr_xy lerp at tick boundaries and re-bless visual goldens in that stage only.",
    "The FOV recompute timing distribution is recorded evidence, not a CI gate; a future recompute-cost regression would surface through the 250 ms frame ceiling rather than a dedicated microbenchmark gate.",
  ],
});
