import {
  type CommandRecord,
  runStageAcceptance,
} from "./lib/engine-accept-stage.ts";

const STAGE_7_PERF_EVIDENCE =
  "docs/design/checkpoints/evidence/engine-render-hot-path-stage-7-perf.json";
// Stage 8 records 148 passing Rust workspace tests: the Stage 7 floor of 147
// plus the new pinned final-acceptance test
// world_draw_cmd_count_is_two_for_floor_player_mvp. A decrease below this
// floor is a red gate.
const STAGE_8_RUST_PASSED_FLOOR = 148;
// Stage 3 world-layer parity reference over the world DrawCmd prefix plus
// world arenas, held exactly through Stages 3-8 (final acceptance matrix:
// "native/browser scenario hashes and draw goldens green").
const STAGE_8_WORLD_DRAW_HASH = "fnv1a64:c55ac880b00ac4d0";
// Stage 4 all-resident play-world state hash; Stage 8 is cleanup and
// documentation only, so it must hold exactly.
const STAGE_8_WORLD_STATE_HASH = "fnv1a64:718bb0099657e9aa";
// Final acceptance-matrix budget established by Stage 7.
const STAGE_8_CEILING_MS = 100;
// The scripted release perf scenario projects exactly 2 visible chunk
// columns at the 1920x1080 reference viewport (Stage 7 evidence).
const STAGE_8_PERF_VISIBLE_COLUMNS = 2;
// Final acceptance matrix: world DrawCmd budget and the pinned actual value.
const WORLD_DRAW_CMD_BUDGET = 4;
const WORLD_DRAW_CMD_COUNT = 2;
const WORLD_DRAW_CMD_TEST =
  "od_wasm tests::world_draw_cmd_count_is_two_for_floor_player_mvp";
// Section 4 acceptance: no obsolete hot-path helper survives the cleanup.
const OBSOLETE_HELPER_PATTERN =
  "render_legacy|smooth_player_world_pos|apply_streaming_chunks|streaming_fingerprint";
const OBSOLETE_HELPER_SEARCH_PATH = "game_engine";
// Stage 2 acceptance re-checked at final acceptance ("Terrain source" row):
// the duplicate sparse/world-vector terrain storage stays deleted.
const TERRAIN_REMNANT_PATTERN =
  "self\\.terrain_blocks|terrain_blocks: HashMap|build_terrain_blocks_cache|blocks: Vec<BlockType>";
const TERRAIN_REMNANT_SEARCH_PATH = "game_engine/od_world";
// Pre-existing `deno lint` findings documented per plan section 5 ("document
// any remaining pre-existing lint findings"): all live in the hand-written
// pre-Stage-0 engine runtime or in wasm-bindgen-generated glue, none in a
// file touched by Stages 0-8.
const PREEXISTING_LINT_FILES = [
  "engine/generated/od_wasm.js",
  "engine/runtime.ts",
  "static/engine/od_wasm.js",
];
const PREEXISTING_LINT_TOTAL = 26;

async function capture(
  command: string,
  args: string[],
  label: string,
  options: { cwd?: string; allowFailure?: boolean } = {},
) {
  console.log(`\n==> ${label}`);
  const output = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  console.log(stdout);
  if (stderr) console.error(stderr);
  if (!output.success && !options.allowFailure) {
    throw new Error(`${label} failed with exit code ${output.code}`);
  }
  return { code: output.code, stdout, stderr };
}

// --- Stage 8 extra lane 1: explicit release rebuild + tool availability ---
// Plan section 5: "At Stage 8, run `deno task engine:build` and repeat the
// engine browser/performance suite against the release-generated artifact.
// Record whether `wasm-opt` and `brotli` were available."
await capture("deno", ["task", "engine:build"], "deno task engine:build");
const releaseMetadata = JSON.parse(
  await Deno.readTextFile("engine/generated/od_wasm.build.json"),
) as {
  profile: string;
  transforms: {
    wasmOpt: { available: boolean; applied: boolean };
    brotli: { available: boolean; applied: boolean };
  };
  tools: Record<string, string | null>;
};
if (releaseMetadata.profile !== "release") {
  throw new Error("engine:build did not produce release metadata");
}
if (
  !releaseMetadata.transforms.wasmOpt.applied ||
  !releaseMetadata.transforms.brotli.applied
) {
  throw new Error(
    "wasm-opt/brotli were not applied to the release artifact; record their absence explicitly instead of accepting silently",
  );
}
const toolAvailability = {
  wasmOpt: {
    ...releaseMetadata.transforms.wasmOpt,
    version: releaseMetadata.tools.wasmOpt,
  },
  brotli: {
    ...releaseMetadata.transforms.brotli,
    version: releaseMetadata.tools.brotli,
  },
  wasmBindgen: releaseMetadata.tools.wasmBindgen,
  cargo: releaseMetadata.tools.cargo,
  rustc: releaseMetadata.tools.rustc,
  rule:
    "plan section 5: record whether wasm-opt and brotli were available at the Stage 8 release build; their absence affects artifact size, not correctness",
};
const engineBuildRecord: CommandRecord = {
  command: "deno task engine:build",
  status: "PASS",
  failed: 0,
  evidence:
    `release wasm regenerated with wasm-opt (${releaseMetadata.tools.wasmOpt}) and brotli (${releaseMetadata.tools.brotli}) applied; metadata profile release`,
};

// --- Stage 8 extra lane 2: full Playwright regression on the release
// artifact (`deno task test`), per plan section 5 "Before final acceptance
// also run `deno task test` and `deno lint`". ---
const denoTaskTestOutput = await capture(
  "deno",
  ["task", "test"],
  "deno task test",
);
const testDiscovered = denoTaskTestOutput.stdout.match(
  /Running (\d+) tests? using/,
);
const testPassed = denoTaskTestOutput.stdout.match(/(\d+) passed/);
const testFailedMatch = denoTaskTestOutput.stdout.match(/(\d+) failed/);
const testSkipped = denoTaskTestOutput.stdout.match(/(\d+) skipped/);
if (!testDiscovered || !testPassed) {
  throw new Error("could not parse `deno task test` discovery/pass counts");
}
const denoTaskTestCounts = {
  discovered: Number(testDiscovered[1]),
  passed: Number(testPassed[1]),
  failed: testFailedMatch ? Number(testFailedMatch[1]) : 0,
  skipped: testSkipped ? Number(testSkipped[1]) : 0,
};
if (denoTaskTestCounts.failed !== 0) {
  throw new Error(`deno task test failures: ${denoTaskTestCounts.failed}`);
}
if (denoTaskTestCounts.discovered < 17) {
  throw new Error(
    `deno task test discovered ${denoTaskTestCounts.discovered} tests, below Stage 0's 17`,
  );
}
if (denoTaskTestCounts.skipped !== 1) {
  throw new Error(
    `deno task test expected exactly the env-gated perf skip, got ${denoTaskTestCounts.skipped}`,
  );
}
if (
  denoTaskTestCounts.passed !==
    denoTaskTestCounts.discovered - denoTaskTestCounts.skipped
) {
  throw new Error("deno task test passed count does not cover discovery");
}
const denoTaskTestRecord: CommandRecord = {
  command: "deno task test",
  status: "PASS",
  discovered: denoTaskTestCounts.discovered,
  passed: denoTaskTestCounts.passed,
  failed: denoTaskTestCounts.failed,
  skipped: denoTaskTestCounts.skipped,
  evidence:
    `full Playwright suite against the release-generated artifact: ${denoTaskTestCounts.discovered} discovered, ${denoTaskTestCounts.passed} passed, ${denoTaskTestCounts.skipped} env-gated skip (perf file without ENGINE_PERF_TEST)`,
};

// --- Stage 8 extra lane 3: `deno lint` with the pre-existing findings
// documented rather than treated as a red engine gate. ---
const lintOutput = await capture(
  "deno",
  ["lint", "--json"],
  "deno lint --json",
  { allowFailure: true },
);
const lintReport = JSON.parse(lintOutput.stdout) as {
  diagnostics: { filename: string; code: string }[];
  errors: unknown[];
};
if (lintReport.errors.length > 0) {
  throw new Error(`deno lint reported parse errors: ${lintOutput.stdout}`);
}
const cwdPrefix = `${Deno.cwd()}/`;
const lintFindingCounts = new Map<string, number>();
for (const diagnostic of lintReport.diagnostics) {
  // `deno lint --json` reports file:// URLs.
  const path = diagnostic.filename.startsWith("file://")
    ? new URL(diagnostic.filename).pathname
    : diagnostic.filename;
  const file = path.startsWith(cwdPrefix) ? path.slice(cwdPrefix.length) : path;
  if (!PREEXISTING_LINT_FILES.includes(file)) {
    throw new Error(
      `new deno lint finding outside the documented pre-existing set: ${file} [${diagnostic.code}]`,
    );
  }
  const key = `${file} [${diagnostic.code}]`;
  lintFindingCounts.set(key, (lintFindingCounts.get(key) ?? 0) + 1);
}
if (lintReport.diagnostics.length !== PREEXISTING_LINT_TOTAL) {
  throw new Error(
    `deno lint finding count ${lintReport.diagnostics.length} != documented pre-existing ${PREEXISTING_LINT_TOTAL}`,
  );
}
const preExistingLintFindings = [...lintFindingCounts.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([finding, count]) => ({ finding, count }));
const denoLintRecord: CommandRecord = {
  command: "deno lint",
  status: "PASS",
  failed: 0,
  expectedExitCode: 1,
  actualExitCode: lintOutput.code,
  evidence:
    `${PREEXISTING_LINT_TOTAL} pre-existing findings, all in the pre-Stage-0 engine runtime (engine/runtime.ts) or wasm-bindgen-generated glue (engine/generated/od_wasm.js, static/engine/od_wasm.js); zero findings in any file touched by Stages 0-8, documented per plan section 5 rather than treated as an engine performance result`,
};
if (lintOutput.code !== 1) {
  throw new Error(
    `deno lint expected exit 1 (documented pre-existing findings), got ${lintOutput.code}`,
  );
}

// --- Stage 8 extra lane 4: pin the world DrawCmd count evidence with a
// targeted run of the new final-acceptance test. ---
const drawCmdTestOutput = await capture(
  "cargo",
  [
    "test",
    "-p",
    "od_wasm",
    "world_draw_cmd_count_is_two_for_floor_player_mvp",
  ],
  "cargo test -p od_wasm world_draw_cmd_count_is_two_for_floor_player_mvp",
  { cwd: "game_engine" },
);
if (
  !drawCmdTestOutput.stdout.includes(
    "test tests::world_draw_cmd_count_is_two_for_floor_player_mvp ... ok",
  )
) {
  throw new Error(
    "pinned world DrawCmd count test did not run/pass in the targeted lane",
  );
}
const worldDrawCmdRecord: CommandRecord = {
  command:
    "cargo test -p od_wasm world_draw_cmd_count_is_two_for_floor_player_mvp",
  status: "PASS",
  passed: 1,
  failed: 0,
  evidence:
    `targeted run of the pinned final-acceptance test: the floor/player MVP tick frame emits exactly ${WORLD_DRAW_CMD_COUNT} world DrawCmds (merged floor-atlas batch + player sprite batch), within the section 7 budget of ${WORLD_DRAW_CMD_BUDGET}`,
};

// --- Final-acceptance-matrix helper checks computed up front. ---
const rgExitCode = async (pattern: string, searchPath: string) => {
  const output = await new Deno.Command("rg", {
    args: [pattern, searchPath],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return output.code;
};
const terrainRemnantExit = await rgExitCode(
  TERRAIN_REMNANT_PATTERN,
  TERRAIN_REMNANT_SEARCH_PATH,
);
if (terrainRemnantExit !== 1) {
  throw new Error(
    `Stage 2 terrain remnant re-check expected rg exit 1, got ${terrainRemnantExit}`,
  );
}

await runStageAcceptance({
  stage: 8,
  rustPassedFloor: { label: "Stage 8", passed: STAGE_8_RUST_PASSED_FLOOR },
  // "The complete matrix in section 7 is green" includes the 100 ms harness
  // ceiling; additionally the median must be no worse than the Stage 7
  // evidence median beyond the Stage 7 evidence's own recorded sample
  // spread (max - min) — the tolerance rule Stages 6 and 7 established.
  baselinePerf: {
    label: "Stage 7",
    evidencePath: STAGE_7_PERF_EVIDENCE,
    toleranceFromRecordedSpread: true,
  },
  // Section 4 Stage 8 acceptance: no obsolete hot-path helper remains.
  remnant: {
    pattern: OBSOLETE_HELPER_PATTERN,
    searchPath: OBSOLETE_HELPER_SEARCH_PATH,
    evidence:
      "no obsolete hot-path helper (legacy snapshot render, shared player smoothing, camera-driven streaming) survives the Stage 8 cleanup; rg exits 1 with no matches",
  },
  // The zero-snapshot renderer holds: zero WorldSim::snapshot() calls on
  // every recorded frame path, unchanged across the ten Stage 4 paths.
  expectedSnapshotCallsPerPath: 0,
  requiredCeilingMs: STAGE_8_CEILING_MS,
  requiredSemantics: {
    // Final acceptance matrix, row by row where the release perf harness
    // owns the value.
    snapshotCallsLastFrame: 0,
    worldDrawHash: STAGE_8_WORLD_DRAW_HASH,
    worldStateHash: STAGE_8_WORLD_STATE_HASH,
    worldTick: 33,
    drawCount: 7,
    floorQuadCount: 130,
    playerQuadCount: 1,
    atlasQuadCount: 131,
    droppedRects: 0,
    droppedGlyphs: 0,
    droppedFrameDrawCmds: 0,
    droppedAtlasQuads: 0,
    droppedSolidQuads: 0,
    droppedWorldDrawCmds: 0,
    droppedSimTimeMs: 0,
    emitColumnRebuilds: 0,
    emitColumnHits: STAGE_8_PERF_VISIBLE_COLUMNS,
    emissionCacheSize: STAGE_8_PERF_VISIBLE_COLUMNS,
  },
  goldensReason:
    "Stage 8 authorizes no golden changes: final acceptance is terminology cleanup and documentation only; every draw/world hash and golden must hold exactly at the Stage 7 values.",
  extraCommands: [
    engineBuildRecord,
    denoTaskTestRecord,
    denoLintRecord,
    worldDrawCmdRecord,
  ],
  buildStageOwned: (
    {
      rustCounts,
      unitCounts,
      playwrightCounts,
      perf,
      baselinePerf,
      profile,
      remnant,
      snapshotCalls,
    },
  ) => {
    if (!remnant) throw new Error("Stage 8 remnant check missing");
    const engineRoute = profile.results["/engine"];
    const webglRoute = profile.results["/webgl"];
    // Final acceptance matrix "Production RAF": /engine must beat the
    // same-run /webgl control.
    if (engineRoute.medianMs >= webglRoute.medianMs) {
      throw new Error(
        `/engine median ${engineRoute.medianMs} ms does not beat the same-run /webgl control ${webglRoute.medianMs} ms`,
      );
    }
    for (const [routeName, route] of Object.entries(profile.results)) {
      if (route.gl.errors.length > 0 || route.gl.contextLost) {
        throw new Error(`${routeName}: GL errors or context loss recorded`);
      }
    }
    if (perf.semantics.emitColumnHits !== perf.semantics.emissionCacheSize) {
      throw new Error("perf emitColumnHits != emissionCacheSize");
    }
    const drops = Object.fromEntries(
      Object.entries(perf.semantics).filter(([name]) =>
        name.startsWith("dropped")
      ),
    );
    // Section 7 final acceptance matrix, one recorded entry per row.
    const finalAcceptanceMatrix = [
      {
        concern: "Terrain source",
        required:
          "one chunk-major authoritative store; no duplicate sparse/world vector",
        recorded: {
          terrainRemnantCommand:
            `rg "${TERRAIN_REMNANT_PATTERN}" ${TERRAIN_REMNANT_SEARCH_PATH}`,
          expectedExitCode: 1,
          actualExitCode: terrainRemnantExit,
        },
        evidence:
          "Stage 2 cutover re-checked at final acceptance: the duplicate sparse terrain map and world-wide x-major vector stay deleted; chunk-major ChunkState is the only terrain store",
      },
      {
        concern: "Camera authority",
        required:
          "view changes alter projection only, never world hash/residency",
        recorded: { worldStateHash: perf.semantics.worldStateHash },
        evidence:
          `all-resident play-world hash ${STAGE_8_WORLD_STATE_HASH} held exactly since the Stage 4 authority cutover; camera/zoom/view-z paths in the snapshot matrix leave tick and hash untouched (paired-engine camera-independence Rust contract tests)`,
      },
      {
        concern: "Hot-path snapshots",
        required: "0 on all normal frame paths",
        recorded: {
          snapshotMatrix: snapshotCalls,
          snapshotCallsLastFrame: perf.semantics.snapshotCallsLastFrame,
        },
        evidence:
          "zero WorldSim::snapshot() calls across all eleven recorded frame paths (debug evidence) and on the warmed release perf frame",
      },
      {
        concern: "20-frame play-world harness",
        required: "median <= 100 ms",
        recorded: {
          medianMs: perf.medianMs,
          p95Ms: perf.p95Ms,
          ceilingMs: perf.ceilingMs,
        },
        evidence:
          "release perf harness evidence; ceiling is the Stage 7 final acceptance-matrix budget",
      },
      {
        concern: "Idle emission rebuilds",
        required: "0 after warmup",
        recorded: {
          emitColumnRebuilds: perf.semantics.emitColumnRebuilds,
          emitColumnHits: perf.semantics.emitColumnHits,
          emissionCacheSize: perf.semantics.emissionCacheSize,
        },
        evidence:
          "warmed final idle frame in the release perf harness performs zero rebuilds with every visible column a hit; the all-columns 0-rebuild/81-hit idle case is owned by the Stage 7 Rust contract tests",
      },
      {
        concern: "FOV scheduling",
        required: "<= 1 recompute per changed fixed tick; 0 idle",
        recorded: { mvpGoldenFovRecomputeCount: 2 },
        evidence:
          "Stage 5 contract tests (idle performs no recompute; one recompute per origin-changing tick) plus the mvp golden play_projection scheduler pin worldRender.fovRecomputeCount == 2, all green in this run's Rust and Playwright lanes",
      },
      {
        concern: "Dropped output",
        required: "0 at reference viewport/zoom",
        recorded: drops,
        evidence:
          "all six drop counters zero in the release perf harness at the 1920x1080 reference viewport",
      },
      {
        concern: "World draw commands",
        required: "<= 4 for current floor/player MVP",
        recorded: {
          worldDrawCmdCount: WORLD_DRAW_CMD_COUNT,
          budget: WORLD_DRAW_CMD_BUDGET,
        },
        evidence:
          `pinned by ${WORLD_DRAW_CMD_TEST} (targeted lane in this run): one merged floor-atlas batch plus one player sprite batch`,
      },
      {
        concern: "Production RAF",
        required:
          "/engine median beats same-run /webgl control; stretch target <= 2 ms",
        recorded: {
          engineMedianMs: engineRoute.medianMs,
          engineP95Ms: engineRoute.p95Ms,
          webglControlMedianMs: webglRoute.medianMs,
          webglControlP95Ms: webglRoute.p95Ms,
          stretchTargetMet: engineRoute.medianMs <= 2,
        },
        evidence:
          "same-run engine:perf profile recorded by this acceptance run; /webgl is the same-run control, not an absolute oracle",
      },
      {
        concern: "Sim recovery",
        required: "long frame bounded; alpha in range; no unbounded backlog",
        recorded: { droppedSimTimeMs: perf.semantics.droppedSimTimeMs },
        evidence:
          "bounded catch-up discards no simulated time at the deterministic 16 ms harness pacing; long-frame clamp, alpha-range, and backlog-bound behavior owned by the Stage 3/6 scheduler and interpolation Rust contract tests, green in this run",
      },
      {
        concern: "Determinism",
        required: "native/browser scenario hashes and draw goldens green",
        recorded: { worldDrawHash: perf.semantics.worldDrawHash },
        evidence:
          `Stage 3 world-layer parity hash held exactly through Stages 3-8; scenario/golden suites green in the Rust workspace and Playwright lanes of this run`,
      },
      {
        concern: "Visual correctness",
        required:
          "existing MVP checkpoints green; interpolation manually verified",
        recorded: {
          playwright: playwrightCounts,
          goldenChanges: "none",
        },
        evidence:
          "MVP checkpoint/golden Playwright tests green against unchanged goldens; manual interpolation verification recorded at Stage 6 (no snap, overshoot, or rubber-banding) with the render path unchanged since",
      },
      {
        concern: "Full regression",
        required: "Rust workspace, engine check, unit, Playwright suites green",
        recorded: {
          rustWorkspace: rustCounts,
          unit: unitCounts,
          playwright: playwrightCounts,
          denoTaskTest: denoTaskTestCounts,
        },
        evidence:
          "engine:test, engine:check, unit, engine Playwright suite, and the full deno task test run all PASS in this acceptance run",
      },
      {
        concern: "Artifact provenance",
        required: "profile plus generated/static/served wasm SHA-256 all agree",
        recorded: {
          debug: "generated/static/metadata/served SHA-256 equal",
          release: "generated/static/metadata/served SHA-256 equal",
        },
        evidence:
          "enforced for both artifacts by the shared acceptance runner; exact hashes recorded in the checkpoint artifacts section",
      },
      {
        concern: "Browser environment",
        required:
          "application-context vendor/renderer recorded; no GL errors/context loss",
        recorded: {
          chromium: profile.chromium,
          viewport: profile.viewport,
          engineGl: engineRoute.gl,
          webglGl: webglRoute.gl,
        },
        evidence:
          "per-route application-context GL identity and health from the same-run profile; zero errors, no context loss",
      },
      {
        concern: "Test discovery",
        required:
          "no unexplained decrease; discovered/passed/failed/skipped counts recorded",
        recorded: {
          enginePlaywright: playwrightCounts,
          denoTaskTest: denoTaskTestCounts,
          stage0DiscoveredFloor: 17,
        },
        evidence:
          "discovery gated at the Stage 0 floor with exactly the one env-gated perf skip in both Playwright lanes",
      },
      {
        concern: "Profiler lifecycle",
        required:
          "reused server preserved; spawned server/browser cleaned on every path",
        recorded: {
          verifiedAt:
            "docs/design/checkpoints/engine-render-hot-path-stage-0.json",
        },
        evidence:
          "spawn/reuse/forced-failure lifecycle commands recorded and validated at Stage 0; the profiler implementation is unchanged and this run's engine:perf spawned and terminated its own server successfully",
      },
    ];
    return {
      snapshotMatrix: {
        requiredCallsPerPath: 0,
        recorded: snapshotCalls,
      },
      rustWorkspaceTests: {
        passed: rustCounts.passed,
        failed: rustCounts.failed,
        passedFloor: STAGE_8_RUST_PASSED_FLOOR,
      },
      perfMedianVsStage7: {
        stage7EvidencePath: baselinePerf.evidencePath,
        stage7MedianMs: baselinePerf.medianMs,
        stage7RecordedSpreadMs: baselinePerf.recordedSpreadMs,
        allowedMedianMs: baselinePerf.allowedMedianMs,
        medianMs: perf.medianMs,
        rule:
          "median <= Stage 7 evidence median + Stage 7 recorded sample spread (max - min): no worse beyond normal recorded variance",
      },
      worldDrawHash: {
        required: STAGE_8_WORLD_DRAW_HASH,
        recorded: perf.semantics.worldDrawHash,
        role:
          "Stage 3 world-layer parity reference held exactly through the Stage 8 cleanup: terminology renames must be behavior-neutral",
      },
      worldStateHash: {
        required: STAGE_8_WORLD_STATE_HASH,
        recorded: perf.semantics.worldStateHash,
        role:
          "Stage 4 all-resident play-world hash; Stage 8 changes no authoritative state",
      },
      droppedSimTimeMs: perf.semantics.droppedSimTimeMs,
      remnantCheck: remnant,
      worldDrawCmdCount: {
        recorded: WORLD_DRAW_CMD_COUNT,
        budget: WORLD_DRAW_CMD_BUDGET,
        test: WORLD_DRAW_CMD_TEST,
        rule:
          "final acceptance matrix: the floor/player MVP emits at most 4 world DrawCmds; the pinned test asserts the current scene emits exactly 2 (merged floor-atlas batch + player sprite batch) and is run both in the workspace lane and as a targeted command in this run",
      },
      finalAcceptanceMatrix,
      toolAvailability,
      denoTaskTest: {
        ...denoTaskTestCounts,
        rule:
          "plan section 5: run deno task test before final acceptance; the full Playwright suite passes against the release-generated artifact with only the env-gated perf skip",
      },
      denoLint: {
        totalFindings: PREEXISTING_LINT_TOTAL,
        newFindings: 0,
        preExistingFindings: preExistingLintFindings,
        rule:
          "plan section 5: document remaining pre-existing lint findings rather than treating lint output as an engine performance result; all findings predate Stage 0 and live in the engine runtime or generated wasm glue",
      },
      deadCodeCleanup: {
        removed:
          "nothing beyond naming: Stage 8 renamed the residual shadow-projection terminology to live-projection naming (reset_projection_state doc comment, client_view_matches_authoritative_chunks_after_tick_frame, client_view_matches_authoritative_bytes_for_complete_window); the snapshot-based render helpers, old visibility storage, and temporary scheduler names named by section 4 were already deleted by Stages 1-7, proven by the obsolete-helper rg exiting 1",
        preExistingOrphans: [
          "od_world WorldState::has_entity",
          "od_world WorldState::spawn_entity_auto",
          "od_world WorldState::spawn_or_replace_entity",
        ],
        preExistingOrphansNote:
          "unreferenced entity helpers in od_world/src/state.rs that predate Stage 0; they are scenario/tooling surface, not hot-path render helpers, and their removal is out of scope for this plan",
      },
      docsUpdated: [
        "docs/GAME_ENGINE_ARCHITECTURE.md",
        "docs/design/engine-webgl-parity-cutover.md",
        "docs/design/engine-render-hot-path-plan.md",
      ],
      perfFixtureCeiling: {
        ceilingMs: STAGE_8_CEILING_MS,
        rule:
          "the Stage 7 100 ms median ceiling is the final acceptance-matrix budget and holds unchanged at Stage 8",
      },
    };
  },
  residualRisks: [
    "The production RAF advantage is recorded on one host/GPU (Chromium on ANGLE Intel Vulkan at 1920x1080 DPR 1); absolute timings vary by host, which is why the gate compares against the same-run /webgl control rather than an absolute number.",
    "The 26 pre-existing deno lint findings live in the pre-Stage-0 engine runtime and wasm-bindgen-generated glue; regenerating glue with a different wasm-bindgen version can change that pinned count and will require re-documenting, not silently loosening, the lint gate.",
    "The pre-existing orphan entity helpers (has_entity, spawn_entity_auto, spawn_or_replace_entity) remain in od_world; they predate Stage 0 and are documented rather than removed, so a future cleanup must re-run the workspace suites when touching them.",
    "WorldSnapshot modernization is intentionally out of scope (plan section 4): on-demand harness snapshot/replay construction keeps its current cost and remains camera-independent; reintroducing snapshot construction into RAF would invalidate the hot-path guarantees this record pins.",
  ],
});
