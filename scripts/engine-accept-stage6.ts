import { runStageAcceptance } from "./lib/engine-accept-stage.ts";

const STAGE_5_PERF_EVIDENCE =
  "docs/design/checkpoints/evidence/engine-render-hot-path-stage-5-perf.json";
// Stage 6 records 138 passing Rust workspace tests (lerp endpoint/midpoint
// exactness, exact player-quad lerp, camera-smoothing separation, monotonic
// sub-tick interpolation, deterministic synthetic sequences, reset/import
// prev == curr); a decrease below this floor is a red gate.
const STAGE_6_RUST_PASSED_FLOOR = 138;
// Stage 3 world-layer parity reference over only the world DrawCmd prefix
// plus world arenas. The scripted perf-scenario player is idle, so
// prev_xy == curr_xy and the fixed-tick lerp is the identity: interpolation
// must not change this hash. Any difference is a stop condition.
const STAGE_6_WORLD_DRAW_HASH = "fnv1a64:c55ac880b00ac4d0";
// Stage 4 all-resident play-world state hash; interpolation is render-only
// and changes no authoritative state, so it must hold exactly.
const STAGE_6_WORLD_STATE_HASH = "fnv1a64:718bb0099657e9aa";
// Stage 6 keeps the Stage 5 20-frame median ceiling at 250 ms; the next
// tightening (100 ms) belongs to Stage 7 emission caching.
const STAGE_6_CEILING_MS = 250;

// Stage 6's single authorized re-bless. It lives in Rust test source (the
// od_wasm parity-anchor test), NOT in a golden file on disk, so the golden
// manifest below is explicitly `none` and this record is stage-owned data.
const PARITY_ANCHOR_REBLESS = {
  file: "game_engine/od_wasm/src/lib.rs",
  test: "od_wasm tests::world_draw_hash_parity_anchors_for_scripted_states",
  anchor: "s3 (default-world entity movement, FOV motion + memory)",
  before: "fnv1a64:ee3f36f2bdc3a71a",
  after: "fnv1a64:5b0d49755d30f709",
  reason:
    "The 10-tick move completes before the s3 capture, so prev_xy == curr_xy and the player quad renders at the exact movement target; the legacy frame-rate exponential smoothing (rate 1 - exp(-0.5) per 50 ms frame) was still converging after 12 frames and produced the old hash. The same test now asserts the exact target-tile quad position as the value-level anchor for this re-bless.",
  authorizedStage: 6,
};

// Named tests enforcing the Stage 6 contracts that Stage 7 consumes
// ("interpolation determinism and lifecycle reset/import behavior"). Later
// stages may strengthen these but may not silently delete, skip, or weaken
// them.
const STAGE_6_CONTRACT_TESTS = {
  lerpEndpointsMidpointAndClamp: [
    "od_world render::tests::lerp_xy_endpoints_bit_exact_midpoint_exact_and_clamped",
  ],
  exactPlayerQuadLerp: [
    "od_world render::tests::player_quad_position_is_exact_fixed_tick_lerp",
  ],
  cameraSmoothingSeparation: [
    "od_wasm tests::camera_smoothing_state_is_separate_and_cannot_affect_player_quad",
  ],
  monotonicSubTickInterpolation: [
    "od_wasm tests::player_quad_interpolates_monotonically_across_sub_tick_frames",
  ],
  deterministicSyntheticSequences: [
    "od_wasm tests::identical_synthetic_frame_sequences_produce_identical_draw_hashes",
  ],
  resetImportPrevEqualsCurr: [
    "od_wasm tests::reset_rebuilds_projection_with_prev_equal_curr",
    "od_wasm tests::import_replay_rebuilds_projection_state",
    "od_world project::tests::project_entities_first_sample_tick_shift_and_despawn",
  ],
};

await runStageAcceptance({
  stage: 6,
  rustPassedFloor: { label: "Stage 6", passed: STAGE_6_RUST_PASSED_FLOOR },
  // "20-frame median/p95 is no worse than Stage 5 beyond normal recorded
  // variance": at the ~5.5 ms Stage 5 median, run-to-run noise exceeds a
  // strict median comparison, so the allowance is the Stage 5 evidence's own
  // recorded sample spread (max - min), never an arbitrary constant.
  baselinePerf: {
    label: "Stage 5",
    evidencePath: STAGE_5_PERF_EVIDENCE,
    toleranceFromRecordedSpread: true,
  },
  // Fixed-tick interpolation is render-only: zero WorldSim::snapshot() calls
  // on every recorded frame path, unchanged across the ten Stage 4 paths.
  expectedSnapshotCallsPerPath: 0,
  // Stage 6 renames/removes the shared smooth_player_world_pos so camera
  // smoothing cannot add a second filter to the player sprite; the remnant
  // check proves the shared helper is gone from all engine crates.
  remnant: {
    pattern: "smooth_player_world_pos",
    searchPath: "game_engine",
    evidence:
      "smooth_player_world_pos removed; camera follow uses camera-only camera_follow_xy and the player quad is lerp(prev_xy, curr_xy, alpha)",
  },
  requiredCeilingMs: STAGE_6_CEILING_MS,
  requiredSemantics: {
    // Interpolation adds no snapshots to the render path.
    snapshotCallsLastFrame: 0,
    // The scripted perf-scenario player is idle (prev == curr, identity
    // lerp): the Stage 3 world-layer parity hash holds exactly.
    worldDrawHash: STAGE_6_WORLD_DRAW_HASH,
    // No authoritative state change: the Stage 4 all-resident hash holds.
    worldStateHash: STAGE_6_WORLD_STATE_HASH,
    worldTick: 33,
    drawCount: 7,
    floorQuadCount: 130,
    playerQuadCount: 1,
    atlasQuadCount: 131,
    // Bounded lag handling must not discard simulated time at the
    // deterministic 16 ms harness pacing used by the release perf run.
    droppedSimTimeMs: 0,
  },
  // Golden files on disk are unchanged: Stage 6's authorized visual re-bless
  // is confined to the Rust parity-anchor test source and is recorded in
  // stage-owned data (parityAnchorRebless), not in the golden manifest.
  goldensReason:
    "Stage 6 changes no golden file on disk: the perf-scenario and MVP paths render an idle player whose lerp is the identity, proven by the exact worldDrawHash gate. The single authorized re-bless is the Rust parity anchor s3 inside od_wasm test source, recorded as the stage-owned parityAnchorRebless value.",
  buildStageOwned: (
    { rustCounts, perf, baselinePerf, remnant, snapshotCalls },
  ) => ({
    snapshotMatrix: {
      requiredCallsPerPath: 0,
      recorded: snapshotCalls,
    },
    remnantCheck: remnant,
    rustWorkspaceTests: {
      passed: rustCounts.passed,
      failed: rustCounts.failed,
      passedFloor: STAGE_6_RUST_PASSED_FLOOR,
    },
    perfMedianVsStage5: {
      stage5EvidencePath: baselinePerf.evidencePath,
      stage5MedianMs: baselinePerf.medianMs,
      stage5RecordedSpreadMs: baselinePerf.recordedSpreadMs,
      allowedMedianMs: baselinePerf.allowedMedianMs,
      medianMs: perf.medianMs,
      rule:
        "median <= Stage 5 evidence median + Stage 5 recorded sample spread (max - min): no worse beyond normal recorded variance",
    },
    worldDrawHash: {
      required: STAGE_6_WORLD_DRAW_HASH,
      recorded: perf.semantics.worldDrawHash,
      role:
        "Stage 3 world-layer parity reference held exactly through the interpolation cutover; the scripted perf player is idle so lerp(prev, curr, alpha) is the identity",
    },
    worldStateHash: {
      required: STAGE_6_WORLD_STATE_HASH,
      recorded: perf.semantics.worldStateHash,
      role:
        "Stage 4 all-resident play-world hash; interpolation is render-only and changes no authoritative state",
    },
    droppedSimTimeMs: perf.semantics.droppedSimTimeMs,
    parityAnchorRebless: PARITY_ANCHOR_REBLESS,
    stage6ContractTests: STAGE_6_CONTRACT_TESTS,
    lifecycleCoverage: {
      note:
        "No teleport command exists in the engine, so reset and import are the covered lifecycle paths for the plan's 'reset/import/teleport initialize prev == curr' acceptance item; a future teleport command must reinitialize interpolation history and extend resetImportPrevEqualsCurr.",
      coveredPaths: ["reset_play_world", "import_replay_json"],
    },
    observabilityKeys: {
      added: ["worldRender.renderAlpha", "worldRender.playerQuadPos"],
      role:
        "debug-snapshot observability for the last render alpha and the interpolated player quad position in world pixels (null when no player quad was emitted)",
    },
  }),
  residualRisks: [
    "The scripted release perf scenario renders an idle player, so the exact worldDrawHash gate proves interpolation neutrality only at identity lerp; moving-player draw output is covered by the Rust contract tests and the re-blessed s3 parity anchor rather than a browser golden.",
    "camera_follow_xy remains an exponential frame-rate filter for the camera only; Stage 8's rg gate still requires smooth_player_world_pos to stay deleted, and any future shared smoothing helper would need a new separation proof.",
  ],
});
