import { runStageAcceptance } from "./lib/engine-accept-stage.ts";

const STAGE_3_PERF_EVIDENCE =
  "docs/design/checkpoints/evidence/engine-render-hot-path-stage-3-perf.json";
// Stage 4 records 119 passing Rust workspace tests (paired-engine camera
// independence, topmost invalidation, explicit-authority residency, and
// ClientView render coverage); a decrease below this floor is a red gate.
const STAGE_4_RUST_PASSED_FLOOR = 119;
// Stage 3 world-layer parity reference over only the world DrawCmd prefix
// plus world arenas. The Stage 4 ClientView renderer must reproduce this
// exact value for the same camera/entity state; any difference is a stop
// condition, never a re-bless.
const STAGE_3_WORLD_DRAW_HASH = "fnv1a64:c55ac880b00ac4d0";
// Stage 4 re-blessed play-world state hash: camera-derived streaming is
// removed, so every generated chunk stays simulation-resident (81 of 81).
const STAGE_4_WORLD_STATE_HASH = "fnv1a64:718bb0099657e9aa";
// Stage 0 play-world state hash retired by the residency re-bless above.
const STAGE_0_WORLD_STATE_HASH = "fnv1a64:11f96a454cacdf3d";
// Stage 4 deletes camera-derived authoritative streaming outright.
const REMNANT_PATTERN = "apply_streaming_chunks|streaming_fingerprint";
// Stage 4 tightens the 20-frame median ceiling from the 6,000 ms Stage 0
// baseline to 400 ms.
const STAGE_4_CEILING_MS = 400;

// The only golden re-blesses authorized for Stage 4, pinned by exact before
// (HEAD) and after (working tree) SHA-256. The world-layer draw output is
// proven unchanged by the exact worldDrawHash gate above.
const STAGE_4_AUTHORIZED_GOLDENS = [
  {
    file: "tests/goldens/engine/checkpoints.json",
    beforeSha256:
      "4ac28f1536294af411c1932031a24a196e1ab8bd3a3119d1f99541e8d0528933",
    afterSha256:
      "b60c07e2439c5d6f010d5b056db50f13fcad35b2447824fc86dd537cbe99544d",
    reason:
      "HUD/debug terminology rename streaming -> projected chunks; world layer proven unchanged by the exact worldDrawHash parity gate",
  },
  {
    file: "tests/goldens/engine/mvp_checkpoints.json",
    beforeSha256:
      "a5326ab85d9267d4631693c1da7e30f57aebb63b438323494565e299b4219668",
    afterSha256:
      "50570106acb9c6242333b734ab8b10404a7f33fe198497f08b131091bcf2e391",
    reason:
      "projectedChunkCount rename; play_projection residency 12 -> 81 chunks and worldStateHash change from the all-resident residency policy; fovRecomputeCount 1 -> 2 from the projection trim tick",
  },
  {
    file: "tests/goldens/engine/scenario_browser.json",
    beforeSha256:
      "ccc75b6dfa177f49a5dc618eb5fe9f0694d3d86666d61ec15861ead30b710d3d",
    afterSha256:
      "6bb8cb237b746f0dfdee24afffdd2dad8f47529ad6bf243f92cc5de93673d0ca",
    reason:
      "HUD/debug terminology rename streaming -> projected chunks in the scripted browser scenario",
  },
];

await runStageAcceptance({
  stage: 4,
  rustPassedFloor: { label: "Stage 4", passed: STAGE_4_RUST_PASSED_FLOOR },
  baselinePerf: { label: "Stage 3", evidencePath: STAGE_3_PERF_EVIDENCE },
  remnant: {
    pattern: REMNANT_PATTERN,
    searchPath: "game_engine/od_wasm/src",
    evidence:
      "no camera-derived authoritative streaming remnants remain in game_engine/od_wasm/src; view input emits no SetChunkLoaded",
  },
  // Zero WorldSim::snapshot() calls on every recorded frame path.
  expectedSnapshotCallsPerPath: 0,
  requiredCeilingMs: STAGE_4_CEILING_MS,
  requiredSemantics: {
    // The renderer consumes only the projected ClientView.
    snapshotCallsLastFrame: 0,
    // Stage 3 world-layer parity: an exact-value gate, not a shape check.
    worldDrawHash: STAGE_3_WORLD_DRAW_HASH,
    // Authorized residency re-bless: all 81 play-world chunks stay resident.
    worldStateHash: STAGE_4_WORLD_STATE_HASH,
    worldTick: 33,
    drawCount: 7,
    floorQuadCount: 130,
    playerQuadCount: 1,
    atlasQuadCount: 131,
    // Bounded lag handling must not discard simulated time at the
    // deterministic 16 ms harness pacing used by the release perf run.
    droppedSimTimeMs: 0,
  },
  authorizedGoldens: STAGE_4_AUTHORIZED_GOLDENS,
  goldensReason:
    "Stage 4 authorizes exactly three golden re-blesses (streaming -> projected terminology and the all-resident play-world residency policy); the world-layer draw output is unchanged, proven by the exact worldDrawHash parity gate.",
  buildStageOwned: (
    { rustCounts, perf, baselinePerf, remnant, snapshotCalls, goldens },
  ) => ({
    snapshotMatrix: {
      requiredCallsPerPath: 0,
      recorded: snapshotCalls,
    },
    remnantCheck: {
      command: remnant!.command,
      expectedExitCode: remnant!.expectedExitCode,
      actualExitCode: remnant!.actualExitCode,
    },
    rustWorkspaceTests: {
      passed: rustCounts.passed,
      failed: rustCounts.failed,
      passedFloor: STAGE_4_RUST_PASSED_FLOOR,
    },
    perfMedianVsStage3: {
      stage3EvidencePath: baselinePerf.evidencePath,
      stage3MedianMs: baselinePerf.medianMs,
      medianMs: perf.medianMs,
    },
    worldDrawHash: {
      required: STAGE_3_WORLD_DRAW_HASH,
      recorded: perf.semantics.worldDrawHash,
      role:
        "Stage 3 world-layer parity reference held exactly through the ClientView render cutover",
    },
    worldStateHash: {
      before: STAGE_0_WORLD_STATE_HASH,
      after: STAGE_4_WORLD_STATE_HASH,
      recorded: perf.semantics.worldStateHash,
      reason:
        "camera-derived streaming removed; every generated play-world chunk remains simulation-resident",
    },
    droppedSimTimeMs: perf.semantics.droppedSimTimeMs,
    goldenRebless: goldens,
    perfFixtureRebless: {
      file: "tests/engine-perf.test.ts",
      worldStateHash: {
        before: STAGE_0_WORLD_STATE_HASH,
        after: STAGE_4_WORLD_STATE_HASH,
      },
      snapshotCallsLastFrame: { before: 1, after: 0 },
      ceilingMs: { before: 6000, after: STAGE_4_CEILING_MS },
      reason:
        "authorized Stage 4 update of the release perf fixture: all-resident world hash, zero-snapshot matrix, and the tightened 400 ms ceiling",
    },
  }),
  residualRisks: [
    "Stage 4 still recomputes legacy-set FOV inside render when dirty; Stage 5 must move recomputation to tick exit and replace VisibilityState with immutable per-chunk bitmap EntityPerspective without changing the draw hash.",
  ],
});
