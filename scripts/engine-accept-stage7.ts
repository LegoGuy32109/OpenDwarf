import { runStageAcceptance } from "./lib/engine-accept-stage.ts";

const STAGE_6_PERF_EVIDENCE =
  "docs/design/checkpoints/evidence/engine-render-hot-path-stage-6-perf.json";
// Stage 7 records 147 passing Rust workspace tests (emission cache
// hit/rebuild/eviction, bounded arena overflow, DrawCmd instance-limit
// preservation, HUD string caching); a decrease below this floor is a red
// gate.
const STAGE_7_RUST_PASSED_FLOOR = 147;
// Stage 3 world-layer parity reference over only the world DrawCmd prefix
// plus world arenas. Cached emission must be value-identical to rebuilt
// emission, so this hash holds exactly through the caching cutover ("draw
// hash unchanged from Stage 6"). Any difference is a stop condition.
const STAGE_7_WORLD_DRAW_HASH = "fnv1a64:c55ac880b00ac4d0";
// Stage 4 all-resident play-world state hash; emission caching is
// render-only and changes no authoritative state, so it must hold exactly.
const STAGE_7_WORLD_STATE_HASH = "fnv1a64:718bb0099657e9aa";
// Stage 7 tightens the 20-frame median ceiling from 250 ms to 100 ms; this
// is also the final acceptance-matrix budget (section 7).
const STAGE_7_CEILING_MS = 100;
// The scripted release perf scenario's local view projects exactly 2
// visible chunk columns at the 1920x1080 reference viewport (the same
// window that produces the pinned 130 floor quads); on the warmed final
// idle frame every one of them is a cache hit. The all-columns case
// (0 rebuilds / 81 hits on the 9x9x1 world) is owned by the named Rust
// contract tests below.
const STAGE_7_PERF_VISIBLE_COLUMNS = 2;

// Named tests enforcing the Stage 7 contracts that Stage 8 consumes
// ("emission hits/rebuilds/eviction and fixed-arena overflow"). Later stages
// may strengthen these but may not silently delete, skip, or weaken them.
const STAGE_7_CONTRACT_TESTS = {
  idleSecondFrameZeroRebuilds: [
    "od_world render::tests::emission_cache_second_idle_frame_performs_zero_rebuilds",
    "od_wasm tests::second_idle_frame_performs_zero_emission_rebuilds",
  ],
  movementRebuildsExactlyPaintChangedColumns: [
    "od_world render::tests::emission_cache_movement_rebuilds_only_paint_changed_columns",
  ],
  viewZInvalidatesAllVisibleColumns: [
    "od_world render::tests::emission_cache_view_z_change_invalidates_all_visible_columns",
  ],
  viewModeIsExactDependency: [
    "od_world render::tests::emission_cache_view_mode_change_invalidates_columns",
  ],
  masterPanBuildsEnteringEvictsLeaving: [
    "od_world render::tests::emission_cache_master_pan_builds_entering_and_evicts_leaving_columns",
  ],
  fixedArenaOverflowNeverReallocates: [
    "od_world render::tests::emission_cache_copy_path_never_grows_exported_arena_on_overflow",
  ],
  drawCmdInstanceLimitPreserved: [
    "od_world render::tests::emission_cache_preserves_draw_cmd_split_at_instance_limit",
  ],
  topmostEvictionOutsideVisibleWindow: [
    "od_world render::tests::topmost_cache_evicts_columns_leaving_the_visible_window",
  ],
  hudLinesCachedByDisplayedValues: [
    "od_wasm tests::hud_lines_rebuild_only_when_displayed_values_change",
  ],
};

// Stage-7-owned emission counter evidence: exact hit/rebuild/eviction values
// asserted by the named contract tests above on the 9x9x1 play world.
const EMISSION_COUNTER_EVIDENCE = {
  idleSecondFrame: {
    columnRebuilds: 0,
    columnHits: 81,
    cacheSize: 81,
    test:
      "od_world render::tests::emission_cache_second_idle_frame_performs_zero_rebuilds",
    rule:
      "first frame builds all 81 visible columns; the second identical frame performs zero rebuilds, hits all 81 columns, and its arena quads plus DrawCmd stream are value-identical to the rebuilt frame",
  },
  movement: {
    rebuiltColumns: [[0, 0], [1, 0]],
    columnHits: 79,
    visibleColumns: 81,
    test:
      "od_world render::tests::emission_cache_movement_rebuilds_only_paint_changed_columns",
    rule:
      "the rebuilt column set equals exactly the columns whose perspective paint revision changed (computed by diffing visibility_revision_by_column across the one-tile move); every unchanged column is a hit and the mixed frame equals a fresh-cache render exactly",
  },
  viewZChange: {
    columnRebuilds: 81,
    columnHits: 0,
    cacheSize: 81,
    test:
      "od_world render::tests::emission_cache_view_z_change_invalidates_all_visible_columns",
    rule: "a view-z change invalidates every visible column",
  },
  masterPan: {
    columnRebuilds: 1,
    rebuiltColumns: [[2, 0]],
    columnHits: 1,
    evictedColumns: [[0, 0]],
    cacheSize: 2,
    test:
      "od_world render::tests::emission_cache_master_pan_builds_entering_and_evicts_leaving_columns",
    rule:
      "a one-column master pan builds exactly the entering column, hits the retained column, and evicts exactly the leaving column",
  },
};

// Stage-7-owned invariant-6 proof: the exported atlas arena never
// reallocates; overflow increments the drop counter exactly on both the
// rebuild path and the cached copy path.
const ARENA_OVERFLOW_PROOF = {
  test:
    "od_world render::tests::emission_cache_copy_path_never_grows_exported_arena_on_overflow",
  arenaCapacity: 100,
  totalFloorQuads: 20736,
  droppedAtlasQuads: 20637,
  rule:
    "with all 81 columns visible the state produces 20736 floor quads; at exported capacity 100 the arena pointer and capacity are bit-identical before/after both the rebuild frame and the all-hit cached frame, the arena fills to exactly 100, and dropped_atlas_quads == 20736 - 100 + 1 (player quad) == 20637 on both paths with value-identical output",
};

// Stage-7-owned DrawCmd budget: every world DrawCmd stays at or below the
// 8,192-instance WebGL limit through the cached emission path.
const DRAW_CMD_INSTANCE_LIMIT = {
  maxInstancesPerDraw: 8192,
  test:
    "od_world render::tests::emission_cache_preserves_draw_cmd_split_at_instance_limit",
  rule:
    "a >8192-quad frame splits its world DrawCmds at exactly 8192 instances; the cached (all-hit) frame reproduces the identical command stream and every world DrawCmd stays <= 8192 instances",
};

// Stage-7-owned HUD hygiene: session HUD strings are cached by displayed
// values, not rebuilt per frame.
const HUD_LINE_CACHE = {
  test: "od_wasm tests::hud_lines_rebuild_only_when_displayed_values_change",
  rule:
    "each HUD line is rebuilt only when a value it displays changed (a view-z change rebuilds only the mode line), idle frames rebuild nothing, cached content equals the uncached builder output, and lifecycle reset repushes all lines",
};

await runStageAcceptance({
  stage: 7,
  rustPassedFloor: { label: "Stage 7", passed: STAGE_7_RUST_PASSED_FLOOR },
  // "20-frame median no worse than Stage 6 beyond normal recorded variance":
  // at the ~4.5 ms Stage 6 median, run-to-run noise exceeds a strict median
  // comparison, so the allowance is the Stage 6 evidence's own recorded
  // sample spread (max - min), never an arbitrary constant (the same rule
  // Stage 6 applied to Stage 5).
  baselinePerf: {
    label: "Stage 6",
    evidencePath: STAGE_6_PERF_EVIDENCE,
    toleranceFromRecordedSpread: true,
  },
  // Emission caching is render-only: zero WorldSim::snapshot() calls on
  // every recorded frame path, unchanged across the ten Stage 4 paths.
  expectedSnapshotCallsPerPath: 0,
  requiredCeilingMs: STAGE_7_CEILING_MS,
  requiredSemantics: {
    // Emission caching adds no snapshots to the render path.
    snapshotCallsLastFrame: 0,
    // Cached emission is value-identical to rebuilt emission: the Stage 3
    // world-layer parity hash holds exactly ("draw hash unchanged from
    // Stage 6").
    worldDrawHash: STAGE_7_WORLD_DRAW_HASH,
    // No authoritative state change: the Stage 4 all-resident hash holds.
    worldStateHash: STAGE_7_WORLD_STATE_HASH,
    worldTick: 33,
    drawCount: 7,
    floorQuadCount: 130,
    playerQuadCount: 1,
    atlasQuadCount: 131,
    // Bounded lag handling must not discard simulated time at the
    // deterministic 16 ms harness pacing used by the release perf run.
    droppedSimTimeMs: 0,
    // Stage 7 browser gate: the warmed final idle frame performs zero
    // emission rebuilds and every visible column is a hit
    // (emitColumnHits == emissionCacheSize == visibleChunks.length == 2
    // in the scripted reference-viewport scenario).
    emitColumnRebuilds: 0,
    emitColumnHits: STAGE_7_PERF_VISIBLE_COLUMNS,
    emissionCacheSize: STAGE_7_PERF_VISIBLE_COLUMNS,
  },
  goldensReason:
    "Stage 7 authorizes no golden changes: cached emission must be value-identical to rebuilt emission, proven by the exact worldDrawHash gate and the Rust value-parity contract tests; no golden file, draw hash, or world hash may move.",
  buildStageOwned: (
    { rustCounts, perf, baselinePerf, snapshotCalls },
  ) => {
    // Field-equality gate independent of the pinned 81/81 constants: the
    // second-idle-frame hit count must equal the emission cache size.
    if (perf.semantics.emitColumnHits !== perf.semantics.emissionCacheSize) {
      throw new Error(
        `perf emitColumnHits ${
          JSON.stringify(perf.semantics.emitColumnHits)
        } != emissionCacheSize ${
          JSON.stringify(perf.semantics.emissionCacheSize)
        }`,
      );
    }
    return {
      snapshotMatrix: {
        requiredCallsPerPath: 0,
        recorded: snapshotCalls,
      },
      rustWorkspaceTests: {
        passed: rustCounts.passed,
        failed: rustCounts.failed,
        passedFloor: STAGE_7_RUST_PASSED_FLOOR,
      },
      perfMedianVsStage6: {
        stage6EvidencePath: baselinePerf.evidencePath,
        stage6MedianMs: baselinePerf.medianMs,
        stage6RecordedSpreadMs: baselinePerf.recordedSpreadMs,
        allowedMedianMs: baselinePerf.allowedMedianMs,
        medianMs: perf.medianMs,
        rule:
          "median <= Stage 6 evidence median + Stage 6 recorded sample spread (max - min): no worse beyond normal recorded variance",
      },
      worldDrawHash: {
        required: STAGE_7_WORLD_DRAW_HASH,
        recorded: perf.semantics.worldDrawHash,
        role:
          "Stage 3 world-layer parity reference held exactly through the emission-cache cutover: cached segments must be value-identical to rebuilt segments",
      },
      worldStateHash: {
        required: STAGE_7_WORLD_STATE_HASH,
        recorded: perf.semantics.worldStateHash,
        role:
          "Stage 4 all-resident play-world hash; emission caching is render-only and changes no authoritative state",
      },
      droppedSimTimeMs: perf.semantics.droppedSimTimeMs,
      emissionCacheCounters: {
        finalIdleFrame: {
          emitColumnRebuilds: perf.semantics.emitColumnRebuilds,
          emitColumnHits: perf.semantics.emitColumnHits,
          emissionCacheSize: perf.semantics.emissionCacheSize,
        },
        rule:
          "release perf harness, warmed final idle frame: zero rebuilds and emitColumnHits == emissionCacheSize == visibleChunks.length (2 projected visible columns in the scripted reference-viewport scenario); the all-columns 0/81 idle case is owned by the Rust contract tests",
      },
      emissionCounterEvidence: EMISSION_COUNTER_EVIDENCE,
      arenaOverflowProof: ARENA_OVERFLOW_PROOF,
      drawCmdInstanceLimit: DRAW_CMD_INSTANCE_LIMIT,
      hudLineCache: HUD_LINE_CACHE,
      stage7ContractTests: STAGE_7_CONTRACT_TESTS,
      observabilityKeys: {
        added: [
          "worldRender.emitColumnRebuilds",
          "worldRender.emitColumnHits",
          "worldRender.emissionCacheSize",
        ],
        role:
          "debug-snapshot observability for per-frame emission cache rebuild/hit counters and the retained cache entry count",
      },
      perfFixtureCeiling: {
        ceilingMs: STAGE_7_CEILING_MS,
        previousCeilingMs: 250,
        rule:
          "Stage 7 tightens the 20-frame median ceiling from 250 ms to 100 ms; this is the final acceptance-matrix budget with zero dropped instances/cmds at the reference viewport",
      },
    };
  },
  residualRisks: [
    "The release perf harness proves idle-hit behavior only (zero rebuilds, 2/2 hits in the scripted reference-viewport window); movement, view-z, view-mode, pan, eviction, and overflow emission behavior is covered by the named Rust contract tests rather than a browser gate.",
    "emitColumnHits/emissionCacheSize are gated to the exact 2 projected visible chunk columns of the scripted scenario at the 1920x1080 reference viewport; a future default viewport/zoom/world/scenario change must re-derive these constants from the new visible window rather than loosening the gate to presence.",
    "The emission cache stores per-column quad segments privately and recopies them into the exported arena every frame per the current ABI; if a future ABI exposes persistent GPU-side segments, the bounded-append/drop-counter proof must be re-established for that path.",
  ],
});
