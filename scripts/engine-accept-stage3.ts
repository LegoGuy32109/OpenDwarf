import { runStageAcceptance } from "./lib/engine-accept-stage.ts";

const STAGE_2_PERF_EVIDENCE =
  "docs/design/checkpoints/evidence/engine-render-hot-path-stage-2-perf.json";
// Stage 3 records 112 passing Rust workspace tests (scheduler split,
// projection window/sync, and shadow-ClientView coverage); a decrease below
// this floor is a red gate.
const STAGE_3_RUST_PASSED_FLOOR = 112;
// On-demand hash over only the world DrawCmd prefix plus world arenas for the
// scripted release perf scenario. Stage 4's ClientView renderer must
// reproduce this exact value for the same camera/entity state.
const STAGE_3_WORLD_DRAW_HASH = "fnv1a64:c55ac880b00ac4d0";

await runStageAcceptance({
  stage: 3,
  rustPassedFloor: { label: "Stage 3", passed: STAGE_3_RUST_PASSED_FLOOR },
  baselinePerf: { label: "Stage 2", evidencePath: STAGE_2_PERF_EVIDENCE },
  requiredSemantics: {
    // Stage 4 world-layer parity reference; an exact-value gate, not a shape
    // check.
    worldDrawHash: STAGE_3_WORLD_DRAW_HASH,
    // Bounded lag handling must not discard simulated time at the
    // deterministic 16 ms harness pacing used by the release perf run.
    droppedSimTimeMs: 0,
  },
  goldensReason:
    "Stage 3 authorizes no golden changes; none were changed or blessed.",
  buildStageOwned: ({ rustCounts, perf, baselinePerf }) => ({
    rustWorkspaceTests: {
      passed: rustCounts.passed,
      failed: rustCounts.failed,
      passedFloor: STAGE_3_RUST_PASSED_FLOOR,
    },
    perfMedianVsStage2: {
      stage2EvidencePath: baselinePerf.evidencePath,
      stage2MedianMs: baselinePerf.medianMs,
      medianMs: perf.medianMs,
    },
    worldDrawHash: {
      required: STAGE_3_WORLD_DRAW_HASH,
      recorded: perf.semantics.worldDrawHash,
      role:
        "Stage 4 world-layer parity reference for the scripted release perf scenario",
    },
    droppedSimTimeMs: perf.semantics.droppedSimTimeMs,
  }),
  residualRisks: [
    "Stage 3 keeps the legacy snapshot renderer for draw output; ClientView is shadow-verified only, and Stage 4 must cut render reads over to it while reproducing the recorded worldDrawHash exactly.",
  ],
});
