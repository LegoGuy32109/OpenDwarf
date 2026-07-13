import { runStageAcceptance } from "./lib/engine-accept-stage.ts";

const REMNANT_PATTERN =
  "self\\.terrain_blocks|terrain_blocks: HashMap|build_terrain_blocks_cache|blocks: Vec<BlockType>";
const STAGE_1_PERF_EVIDENCE =
  "docs/design/checkpoints/evidence/engine-render-hot-path-stage-1-perf.json";
// Stage 1 recorded 73 passing Rust workspace tests; a decrease is a red gate.
const STAGE_1_RUST_PASSED = 73;

await runStageAcceptance({
  stage: 2,
  rustPassedFloor: { label: "Stage 1", passed: STAGE_1_RUST_PASSED },
  baselinePerf: { label: "Stage 1", evidencePath: STAGE_1_PERF_EVIDENCE },
  remnant: {
    pattern: REMNANT_PATTERN,
    searchPath: "game_engine/od_world",
    evidence:
      "no authoritative terrain-store remnants remain in game_engine/od_world; snapshot()-local BTreeMap only",
  },
  goldensReason:
    "Stage 2 authorizes no golden changes; none were changed or blessed.",
  buildStageOwned: ({ rustCounts, perf, baselinePerf, remnant }) => ({
    remnantCheck: {
      command: remnant!.command,
      expectedExitCode: remnant!.expectedExitCode,
      actualExitCode: remnant!.actualExitCode,
    },
    rustWorkspaceTests: {
      passed: rustCounts.passed,
      failed: rustCounts.failed,
      stage1PassedFloor: STAGE_1_RUST_PASSED,
    },
    perfMedianVsStage1: {
      stage1EvidencePath: baselinePerf.evidencePath,
      stage1MedianMs: baselinePerf.medianMs,
      medianMs: perf.medianMs,
    },
  }),
  residualRisks: [
    "Stage 2 keeps the legacy renderer's single hot-path snapshot; Stage 3 introduces the fixed scheduler and shadow ClientView before any render cutover.",
  ],
});
