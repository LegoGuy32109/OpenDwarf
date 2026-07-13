import { createHash } from "node:crypto";

type CommandResult = {
  command: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  discovered?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  expectedExitCode?: number;
  actualExitCode?: number;
  evidence: string;
};

type ArtifactEvidence = {
  profile: "debug" | "release";
  metadataPath: string;
  generatedSha256: string;
  staticSha256: string;
  servedSha256: string;
};

type RouteProfile = {
  samplesMs: number[];
  medianMs: number;
  p95Ms: number;
  gl: {
    vendor: string;
    renderer: string;
    rendererSource: string;
    errors: number[];
    contextLost: boolean;
  };
};

type Checkpoint = {
  schemaVersion: number;
  stage: number;
  status: "PASS" | "FAIL" | "BLOCKED";
  generatedBy?: string;
  reviewedImplementation: {
    mode: "worktree" | "commit" | "content";
    head: string;
    workspaceDiffSha256: string | null;
    contentSha256?: string;
  };
  artifacts: {
    debug: ArtifactEvidence;
    release: ArtifactEvidence;
  };
  environment: {
    chromium: string;
    viewport: { width: number; height: number; deviceScaleFactor: number };
  };
  commands: CommandResult[];
  snapshotCalls: Record<string, number>;
  snapshotEvidencePath?: string;
  harnessPerformance: {
    artifactPath?: string;
    samplesMs: number[];
    medianMs: number;
    p95Ms: number;
    ceilingMs: number;
    semantics: {
      floorQuadCount: number;
      playerQuadCount: number;
      atlasQuadCount: number;
      worldTick: number;
      worldStateHash: string;
      drawCount: number;
      observedDrawHash: string;
      droppedRects: number;
      droppedGlyphs: number;
      droppedFrameDrawCmds: number;
      droppedAtlasQuads: number;
      droppedSolidQuads: number;
      droppedWorldDrawCmds: number;
      snapshotCallsLastFrame?: number;
      worldDrawHash?: string;
      droppedSimTimeMs?: number;
      emitColumnRebuilds?: number;
      emitColumnHits?: number;
      emissionCacheSize?: number;
    };
  };
  sameRunProfile: {
    artifactPath: string;
    webgl: RouteProfile;
    engine: RouteProfile;
  };
  goldens: {
    changedFiles: string[];
    authorizedStage?: number;
    changed?: {
      file: string;
      beforeSha256: string;
      afterSha256: string;
      reason: string;
    }[];
    reason: string;
    sha256ByFile?: Record<string, string>;
  };
  stageOwned?: Record<string, unknown>;
  authorizedDeferrals: string[];
  residualRisks: string[];
};

type GeneratedStageSpec = {
  acceptTask: string;
  requiredCommands: string[];
  // A baseline with `toleranceFromRecordedSpread` allows the recorded median
  // to exceed the baseline evidence median by at most that evidence's own
  // recorded sample spread (max - min): "no worse beyond normal recorded
  // variance". Strict (zero tolerance) otherwise.
  baseline:
    | { label: string; medianMs: number }
    | {
      label: string;
      evidencePath: string;
      toleranceFromRecordedSpread?: boolean;
    };
  remnantCommand?: string;
  rustTests?: { command: string; minimumPassed: number };
  // Exact per-path snapshot matrix (default: the Stage 1-3 all-1 five-path
  // matrix). Keys and values must match exactly.
  snapshotMatrix?: Record<string, number>;
  // Exact `snapshotCallsLastFrame` in the perf semantics (default 1).
  snapshotCallsLastFrame?: number;
  // Exact perf `worldStateHash` (default: the Stage 0 play-world hash).
  worldStateHash?: string;
  // Exact perf harness ceiling, when a stage pins/tightens it.
  ceilingMs?: number;
  // Extra exact snapshot-evidence pathState assertions beyond the Stage 0-3
  // core set.
  pathState?: Record<string, unknown>;
  // Exact stage-owned values required in the recorded perf harness semantics.
  requiredSemantics?: Record<string, string | number>;
  // Golden re-blesses this stage authorizes, pinned by exact hashes. The
  // checkpoint must record exactly this list; an omitted/empty list requires
  // zero golden changes.
  authorizedGoldens?: {
    file: string;
    beforeSha256: string;
    afterSha256: string;
  }[];
  stageOwnedKeys?: string[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseStage(args: string[]) {
  const index = args.indexOf("--stage");
  const value = index >= 0 ? Number(args[index + 1]) : Number.NaN;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      "usage: validate-engine-hot-path-checkpoint.ts --stage <N>",
    );
  }
  return value;
}

async function git(args: string[]) {
  const output = await new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  return output.stdout;
}

function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileSha256(path: string) {
  return hashBytes(await Deno.readFile(path));
}

async function workspaceDiffSha256(recordPath: string) {
  const hash = createHash("sha256");
  hash.update(
    await git(["diff", "--binary", "--", ".", `:(exclude)${recordPath}`]),
  );
  const untracked = new TextDecoder().decode(
    await git(["ls-files", "--others", "--exclude-standard"]),
  ).trim().split("\n").filter((path) => path && path !== recordPath).sort();
  for (const path of untracked) {
    hash.update("\0UNTRACKED\0");
    hash.update(path);
    hash.update("\0");
    hash.update(await Deno.readFile(path));
  }
  return hash.digest("hex");
}

async function repositoryContentSha256(recordPath: string) {
  const tracked = new TextDecoder().decode(
    await git(["ls-files"]),
  ).trim().split("\n").filter(Boolean);
  const untracked = new TextDecoder().decode(
    await git(["ls-files", "--others", "--exclude-standard"]),
  ).trim().split("\n").filter(Boolean);
  const paths = [...new Set([...tracked, ...untracked])]
    .filter((path) => path !== recordPath)
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(await Deno.readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function percentile(samples: number[], fraction: number) {
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[
    Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))
  ]!;
}

function assertMetric(actual: number, expected: number, label: string) {
  assert(
    Math.abs(actual - expected) < 0.001,
    `${label}: recorded ${actual}, recomputed ${expected}`,
  );
}

function assertRoute(route: RouteProfile, label: string) {
  assert(route.samplesMs.length === 20, `${label}: expected 20 samples`);
  assertMetric(
    route.medianMs,
    percentile(route.samplesMs, 0.5),
    `${label} median`,
  );
  assertMetric(route.p95Ms, percentile(route.samplesMs, 0.95), `${label} p95`);
  assert(route.gl.vendor.length > 0, `${label}: missing GL vendor`);
  assert(route.gl.renderer.length > 0, `${label}: missing GL renderer`);
  assert(
    route.gl.rendererSource.length > 0,
    `${label}: missing renderer source`,
  );
  assert(route.gl.errors.length === 0, `${label}: WebGL errors recorded`);
  assert(!route.gl.contextLost, `${label}: WebGL context was lost`);
}

const stage = parseStage(Deno.args);
const recordPath =
  `docs/design/checkpoints/engine-render-hot-path-stage-${stage}.json`;
if (Deno.args.includes("--print-worktree-sha")) {
  console.log(await workspaceDiffSha256(recordPath));
  Deno.exit(0);
}
if (Deno.args.includes("--print-content-sha")) {
  console.log(await repositoryContentSha256(recordPath));
  Deno.exit(0);
}

const checkpoint = JSON.parse(
  await Deno.readTextFile(recordPath),
) as Checkpoint;
assert(checkpoint.schemaVersion === 1, "unsupported checkpoint schema");
assert(
  checkpoint.stage === stage,
  `record stage ${checkpoint.stage} != ${stage}`,
);
assert(
  checkpoint.status === "PASS",
  `checkpoint status is ${checkpoint.status}`,
);

const head = new TextDecoder().decode(await git(["rev-parse", "HEAD"])).trim();
if (checkpoint.reviewedImplementation.mode === "worktree") {
  assert(
    checkpoint.reviewedImplementation.head === head,
    "reviewed HEAD is stale",
  );
  assert(
    checkpoint.reviewedImplementation.workspaceDiffSha256 ===
      await workspaceDiffSha256(recordPath),
    "reviewed worktree digest is stale",
  );
} else if (checkpoint.reviewedImplementation.mode === "content") {
  assert(
    checkpoint.reviewedImplementation.workspaceDiffSha256 === null,
    "content-mode checkpoint must not carry a worktree digest",
  );
  assert(
    checkpoint.reviewedImplementation.contentSha256 ===
      await repositoryContentSha256(recordPath),
    "reviewed repository content digest is stale",
  );
} else {
  assert(
    checkpoint.reviewedImplementation.workspaceDiffSha256 === null,
    "commit-mode checkpoint must not carry a worktree digest",
  );
  const ancestor = await new Deno.Command("git", {
    args: [
      "merge-base",
      "--is-ancestor",
      checkpoint.reviewedImplementation.head,
      head,
    ],
  }).output();
  assert(ancestor.success, "reviewed implementation commit is not an ancestor");
}

for (const [name, artifact] of Object.entries(checkpoint.artifacts)) {
  assert(artifact.profile === name, `${name}: profile mismatch`);
  for (
    const [field, value] of Object.entries({
      generatedSha256: artifact.generatedSha256,
      staticSha256: artifact.staticSha256,
      servedSha256: artifact.servedSha256,
    })
  ) {
    assert(/^[0-9a-f]{64}$/.test(value), `${name}.${field}: invalid SHA-256`);
  }
  assert(
    artifact.generatedSha256 === artifact.staticSha256 &&
      artifact.generatedSha256 === artifact.servedSha256,
    `${name}: generated/static/served hashes disagree`,
  );
}

const releaseMetadata = JSON.parse(
  await Deno.readTextFile(checkpoint.artifacts.release.metadataPath),
) as { profile: string; wasm: { sha256: string } };
assert(
  releaseMetadata.profile === "release",
  "current metadata is not release",
);
assert(
  releaseMetadata.wasm.sha256 === checkpoint.artifacts.release.generatedSha256,
  "release metadata hash disagrees with checkpoint",
);
assert(
  await fileSha256("engine/generated/od_wasm_bg.wasm") ===
    checkpoint.artifacts.release.generatedSha256,
  "generated release wasm disagrees with checkpoint",
);
assert(
  await fileSha256("static/engine/od_wasm_bg.wasm") ===
    checkpoint.artifacts.release.staticSha256,
  "static release wasm disagrees with checkpoint",
);

assert(checkpoint.environment.chromium.length > 0, "missing Chromium version");
assert(
  checkpoint.environment.viewport.width === 1920,
  "unexpected viewport width",
);
assert(
  checkpoint.environment.viewport.height === 1080,
  "unexpected viewport height",
);
assert(
  checkpoint.environment.viewport.deviceScaleFactor === 1,
  "unexpected deviceScaleFactor",
);

const stageZeroCommands = [
  "deno task engine:test",
  "deno task engine:check",
  "deno task engine:dev",
  "deno task unit",
  "npx playwright test tests/engine*.test.ts --workers=1",
  "deno task engine:test-perf-browser",
  "deno task engine:perf (self-spawn)",
  "deno task engine:perf (reuse existing server)",
  "deno run -A scripts/engine-perf-profile.ts (forced readiness failure)",
];
const acceptanceLaneCommands = [
  "deno task engine:test",
  "deno task engine:check",
  "deno task engine:dev",
  "deno task unit",
  "npx playwright test tests/engine*.test.ts --workers=1",
  "deno task engine:test-perf-browser",
  "deno task engine:perf",
];
const stageTwoRemnantCommand =
  'rg "self\\.terrain_blocks|terrain_blocks: HashMap|build_terrain_blocks_cache|blocks: Vec<BlockType>" game_engine/od_world';
const stageFourRemnantCommand =
  'rg "apply_streaming_chunks|streaming_fingerprint" game_engine/od_wasm/src';
const stageSixRemnantCommand = 'rg "smooth_player_world_pos" game_engine';
const stageEightRemnantCommand =
  'rg "render_legacy|smooth_player_world_pos|apply_streaming_chunks|streaming_fingerprint" game_engine';
const generatedStageSpecs = new Map<number, GeneratedStageSpec>([
  [1, {
    acceptTask: "deno task engine:accept-stage1",
    requiredCommands: acceptanceLaneCommands,
    baseline: { label: "Stage 0", medianMs: 3537.7 },
  }],
  [2, {
    acceptTask: "deno task engine:accept-stage2",
    requiredCommands: [...acceptanceLaneCommands, stageTwoRemnantCommand],
    baseline: {
      label: "Stage 1",
      evidencePath:
        "docs/design/checkpoints/evidence/engine-render-hot-path-stage-1-perf.json",
    },
    remnantCommand: stageTwoRemnantCommand,
    // Stage 1 recorded 73 passing workspace tests; a decrease is a red gate.
    rustTests: { command: "deno task engine:test", minimumPassed: 73 },
    stageOwnedKeys: [
      "remnantCheck",
      "rustWorkspaceTests",
      "perfMedianVsStage1",
    ],
  }],
  [3, {
    acceptTask: "deno task engine:accept-stage3",
    requiredCommands: acceptanceLaneCommands,
    baseline: {
      label: "Stage 2",
      evidencePath:
        "docs/design/checkpoints/evidence/engine-render-hot-path-stage-2-perf.json",
    },
    // Stage 3 records 112 passing workspace tests (scheduler split,
    // projection window/sync, shadow ClientView); a decrease is a red gate.
    rustTests: { command: "deno task engine:test", minimumPassed: 112 },
    requiredSemantics: {
      // Scripted perf-scenario world-layer hash; the Stage 4 ClientView
      // renderer must reproduce this exact value.
      worldDrawHash: "fnv1a64:c55ac880b00ac4d0",
      // Bounded lag handling must not discard simulated time at the
      // deterministic 16 ms harness pacing.
      droppedSimTimeMs: 0,
    },
    stageOwnedKeys: [
      "rustWorkspaceTests",
      "perfMedianVsStage2",
      "worldDrawHash",
      "droppedSimTimeMs",
    ],
  }],
  [4, {
    acceptTask: "deno task engine:accept-stage4",
    requiredCommands: [...acceptanceLaneCommands, stageFourRemnantCommand],
    baseline: {
      label: "Stage 3",
      evidencePath:
        "docs/design/checkpoints/evidence/engine-render-hot-path-stage-3-perf.json",
    },
    remnantCommand: stageFourRemnantCommand,
    // Stage 4 records 119 passing workspace tests (paired-engine camera
    // independence, topmost invalidation, explicit authority residency,
    // ClientView render); a decrease is a red gate.
    rustTests: { command: "deno task engine:test", minimumPassed: 119 },
    // The ClientView renderer performs zero WorldSim::snapshot() calls on
    // every recorded frame path (authorized matrix update: 1 -> 0).
    snapshotMatrix: {
      idle: 0,
      tick: 0,
      movement: 0,
      camera: 0,
      zoom: 0,
      viewZ: 0,
      resize: 0,
      master: 0,
      entity: 0,
      chat: 0,
      shell: 0,
    },
    snapshotCallsLastFrame: 0,
    // Authorized Stage 4 residency re-bless: camera streaming removed, so
    // all 81 play-world chunks remain simulation-resident.
    worldStateHash: "fnv1a64:718bb0099657e9aa",
    // Stage 4 tightens the 20-frame median ceiling to 400 ms.
    ceilingMs: 400,
    pathState: {
      zoomChanged: true,
      viewZDelta: 1,
      framebufferChanged: true,
      masterMode: "master",
      entityMode: "entity",
      shellOpen: true,
    },
    requiredSemantics: {
      // Stage 3 world-layer parity reference held exactly through the
      // ClientView render cutover; a difference is a stop condition.
      worldDrawHash: "fnv1a64:c55ac880b00ac4d0",
      // Bounded lag handling must not discard simulated time at the
      // deterministic 16 ms harness pacing.
      droppedSimTimeMs: 0,
    },
    // Exactly these three golden re-blesses are authorized for Stage 4;
    // "none" or any other changed set is a red gate.
    authorizedGoldens: [
      {
        file: "tests/goldens/engine/checkpoints.json",
        beforeSha256:
          "4ac28f1536294af411c1932031a24a196e1ab8bd3a3119d1f99541e8d0528933",
        afterSha256:
          "b60c07e2439c5d6f010d5b056db50f13fcad35b2447824fc86dd537cbe99544d",
      },
      {
        file: "tests/goldens/engine/mvp_checkpoints.json",
        beforeSha256:
          "a5326ab85d9267d4631693c1da7e30f57aebb63b438323494565e299b4219668",
        afterSha256:
          "50570106acb9c6242333b734ab8b10404a7f33fe198497f08b131091bcf2e391",
      },
      {
        file: "tests/goldens/engine/scenario_browser.json",
        beforeSha256:
          "ccc75b6dfa177f49a5dc618eb5fe9f0694d3d86666d61ec15861ead30b710d3d",
        afterSha256:
          "6bb8cb237b746f0dfdee24afffdd2dad8f47529ad6bf243f92cc5de93673d0ca",
      },
    ],
    stageOwnedKeys: [
      "snapshotMatrix",
      "remnantCheck",
      "rustWorkspaceTests",
      "perfMedianVsStage3",
      "worldDrawHash",
      "worldStateHash",
      "droppedSimTimeMs",
      "goldenRebless",
      "perfFixtureRebless",
    ],
  }],
  [5, {
    acceptTask: "deno task engine:accept-stage5",
    requiredCommands: acceptanceLaneCommands,
    baseline: {
      label: "Stage 4",
      evidencePath:
        "docs/design/checkpoints/evidence/engine-render-hot-path-stage-4-perf.json",
    },
    // Stage 5 records 133 passing workspace tests (FOV bitmap parity,
    // perspective memory persistence, tick-exit scheduling, master-mode
    // clear/preserve, per-column revisions); a decrease is a red gate.
    rustTests: { command: "deno task engine:test", minimumPassed: 133 },
    // The bitmap-perspective renderer keeps zero WorldSim::snapshot() calls
    // on every Stage 4 frame path.
    snapshotMatrix: {
      idle: 0,
      tick: 0,
      movement: 0,
      camera: 0,
      zoom: 0,
      viewZ: 0,
      resize: 0,
      master: 0,
      entity: 0,
      chat: 0,
      shell: 0,
    },
    snapshotCallsLastFrame: 0,
    // Stage 5 changes no authoritative state: the Stage 4 all-resident
    // play-world hash must hold exactly.
    worldStateHash: "fnv1a64:718bb0099657e9aa",
    // Stage 5 tightens the 20-frame median ceiling to 250 ms.
    ceilingMs: 250,
    pathState: {
      zoomChanged: true,
      viewZDelta: 1,
      framebufferChanged: true,
      masterMode: "master",
      entityMode: "entity",
      shellOpen: true,
    },
    requiredSemantics: {
      // "Draw hash unchanged from Stage 4": the Stage 3 world-layer parity
      // reference must hold exactly through the bitmap/tick-exit-FOV cutover.
      worldDrawHash: "fnv1a64:c55ac880b00ac4d0",
      // Bounded lag handling must not discard simulated time at the
      // deterministic 16 ms harness pacing.
      droppedSimTimeMs: 0,
    },
    // Stage 5 authorizes no golden changes ("unchanged from Stage 4").
    stageOwnedKeys: [
      "snapshotMatrix",
      "rustWorkspaceTests",
      "perfMedianVsStage4",
      "worldDrawHash",
      "worldStateHash",
      "droppedSimTimeMs",
      "fovRecomputeDistribution",
      "mvpFovRecomputeCount",
      "stage5ContractTests",
      "perfFixtureCeiling",
    ],
  }],
  [6, {
    acceptTask: "deno task engine:accept-stage6",
    requiredCommands: [...acceptanceLaneCommands, stageSixRemnantCommand],
    baseline: {
      label: "Stage 5",
      evidencePath:
        "docs/design/checkpoints/evidence/engine-render-hot-path-stage-5-perf.json",
      // "No worse than Stage 5 beyond normal recorded variance": at the
      // ~5.5 ms Stage 5 median, run-to-run noise exceeds a strict
      // comparison, so the allowance is the Stage 5 evidence's own
      // recorded sample spread.
      toleranceFromRecordedSpread: true,
    },
    // Stage 6 renames/removes the shared smooth_player_world_pos: camera
    // follow keeps its own camera_follow_xy and the player quad is always
    // lerp(prev_xy, curr_xy, alpha).
    remnantCommand: stageSixRemnantCommand,
    // Stage 6 records 138 passing workspace tests (lerp endpoint/midpoint
    // exactness, exact player-quad lerp, camera-smoothing separation,
    // monotonic sub-tick interpolation, deterministic synthetic sequences,
    // reset/import prev == curr); a decrease is a red gate.
    rustTests: { command: "deno task engine:test", minimumPassed: 138 },
    // Fixed-tick interpolation is render-only: zero WorldSim::snapshot()
    // calls on every Stage 4 frame path.
    snapshotMatrix: {
      idle: 0,
      tick: 0,
      movement: 0,
      camera: 0,
      zoom: 0,
      viewZ: 0,
      resize: 0,
      master: 0,
      entity: 0,
      chat: 0,
      shell: 0,
    },
    snapshotCallsLastFrame: 0,
    // Interpolation changes no authoritative state: the Stage 4 all-resident
    // play-world hash must hold exactly.
    worldStateHash: "fnv1a64:718bb0099657e9aa",
    // Stage 6 keeps the Stage 5 250 ms ceiling; Stage 7 tightens to 100 ms.
    ceilingMs: 250,
    pathState: {
      zoomChanged: true,
      viewZDelta: 1,
      framebufferChanged: true,
      masterMode: "master",
      entityMode: "entity",
      shellOpen: true,
    },
    requiredSemantics: {
      // The scripted perf-scenario player is idle (prev == curr, identity
      // lerp): the Stage 3 world-layer parity reference must hold exactly.
      worldDrawHash: "fnv1a64:c55ac880b00ac4d0",
      // Bounded lag handling must not discard simulated time at the
      // deterministic 16 ms harness pacing.
      droppedSimTimeMs: 0,
    },
    // Stage 6 authorizes no golden-file changes: the single authorized
    // re-bless is the Rust parity anchor s3 inside od_wasm test source
    // (fnv1a64:ee3f36f2bdc3a71a -> fnv1a64:5b0d49755d30f709), recorded in
    // the stage-owned parityAnchorRebless value, not the golden manifest.
    stageOwnedKeys: [
      "snapshotMatrix",
      "remnantCheck",
      "rustWorkspaceTests",
      "perfMedianVsStage5",
      "worldDrawHash",
      "worldStateHash",
      "droppedSimTimeMs",
      "parityAnchorRebless",
      "stage6ContractTests",
      "lifecycleCoverage",
      "observabilityKeys",
    ],
  }],
  [7, {
    acceptTask: "deno task engine:accept-stage7",
    requiredCommands: acceptanceLaneCommands,
    baseline: {
      label: "Stage 6",
      evidencePath:
        "docs/design/checkpoints/evidence/engine-render-hot-path-stage-6-perf.json",
      // "No worse than Stage 6 beyond normal recorded variance": at the
      // ~4.5 ms Stage 6 median, run-to-run noise exceeds a strict
      // comparison, so the allowance is the Stage 6 evidence's own
      // recorded sample spread (the rule Stage 6 established).
      toleranceFromRecordedSpread: true,
    },
    // Stage 7 records 147 passing workspace tests (emission cache
    // hit/rebuild/eviction, bounded arena overflow, DrawCmd instance-limit
    // preservation, HUD string caching); a decrease is a red gate.
    rustTests: { command: "deno task engine:test", minimumPassed: 147 },
    // Emission caching is render-only: zero WorldSim::snapshot() calls on
    // every Stage 4 frame path.
    snapshotMatrix: {
      idle: 0,
      tick: 0,
      movement: 0,
      camera: 0,
      zoom: 0,
      viewZ: 0,
      resize: 0,
      master: 0,
      entity: 0,
      chat: 0,
      shell: 0,
    },
    snapshotCallsLastFrame: 0,
    // Emission caching changes no authoritative state: the Stage 4
    // all-resident play-world hash must hold exactly.
    worldStateHash: "fnv1a64:718bb0099657e9aa",
    // Stage 7 tightens the 20-frame median ceiling to 100 ms — the final
    // acceptance-matrix budget.
    ceilingMs: 100,
    pathState: {
      zoomChanged: true,
      viewZDelta: 1,
      framebufferChanged: true,
      masterMode: "master",
      entityMode: "entity",
      shellOpen: true,
    },
    requiredSemantics: {
      // Cached emission must be value-identical to rebuilt emission: the
      // Stage 3 world-layer parity reference holds exactly ("draw hash
      // unchanged from Stage 6").
      worldDrawHash: "fnv1a64:c55ac880b00ac4d0",
      // Bounded lag handling must not discard simulated time at the
      // deterministic 16 ms harness pacing.
      droppedSimTimeMs: 0,
      // Stage 7 browser gate: the warmed final idle frame performs zero
      // emission rebuilds and every visible column is a hit —
      // emitColumnHits == emissionCacheSize == the scripted scenario's 2
      // projected visible chunk columns at the reference viewport. The
      // all-columns idle case (0 rebuilds / 81 hits) is owned by the named
      // Rust contract tests recorded in stage-owned data.
      emitColumnRebuilds: 0,
      emitColumnHits: 2,
      emissionCacheSize: 2,
    },
    // Stage 7 authorizes no golden changes ("unchanged from Stage 6").
    stageOwnedKeys: [
      "snapshotMatrix",
      "rustWorkspaceTests",
      "perfMedianVsStage6",
      "worldDrawHash",
      "worldStateHash",
      "droppedSimTimeMs",
      "emissionCacheCounters",
      "emissionCounterEvidence",
      "arenaOverflowProof",
      "drawCmdInstanceLimit",
      "hudLineCache",
      "stage7ContractTests",
      "observabilityKeys",
      "perfFixtureCeiling",
    ],
  }],
  [8, {
    acceptTask: "deno task engine:accept-stage8",
    requiredCommands: [
      ...acceptanceLaneCommands,
      stageEightRemnantCommand,
      // Stage 8 extras (plan sections 4/5): explicit release rebuild with
      // wasm-opt/brotli availability recorded, the full Playwright suite
      // and lint documentation before final acceptance, and the targeted
      // pinned world-DrawCmd-count lane.
      "deno task engine:build",
      "deno task test",
      "deno lint",
      "cargo test -p od_wasm world_draw_cmd_count_is_two_for_floor_player_mvp",
    ],
    baseline: {
      label: "Stage 7",
      evidencePath:
        "docs/design/checkpoints/evidence/engine-render-hot-path-stage-7-perf.json",
      // "No worse than Stage 7 beyond normal recorded variance": the
      // allowance is the Stage 7 evidence's own recorded sample spread
      // (max - min), the rule Stages 6 and 7 established.
      toleranceFromRecordedSpread: true,
    },
    // Section 4 Stage 8 acceptance: no obsolete hot-path helper survives
    // the final cleanup.
    remnantCommand: stageEightRemnantCommand,
    // Stage 8 records 148 passing workspace tests (the Stage 7 floor plus
    // the pinned world_draw_cmd_count_is_two_for_floor_player_mvp final
    // acceptance test); a decrease is a red gate.
    rustTests: { command: "deno task engine:test", minimumPassed: 148 },
    // The zero-snapshot renderer holds: zero WorldSim::snapshot() calls on
    // every Stage 4 frame path.
    snapshotMatrix: {
      idle: 0,
      tick: 0,
      movement: 0,
      camera: 0,
      zoom: 0,
      viewZ: 0,
      resize: 0,
      master: 0,
      entity: 0,
      chat: 0,
      shell: 0,
    },
    snapshotCallsLastFrame: 0,
    // Stage 8 changes no authoritative state: the Stage 4 all-resident
    // play-world hash must hold exactly.
    worldStateHash: "fnv1a64:718bb0099657e9aa",
    // The Stage 7 100 ms ceiling is the final acceptance-matrix budget.
    ceilingMs: 100,
    pathState: {
      zoomChanged: true,
      viewZDelta: 1,
      framebufferChanged: true,
      masterMode: "master",
      entityMode: "entity",
      shellOpen: true,
    },
    requiredSemantics: {
      // Terminology cleanup must be behavior-neutral: the Stage 3
      // world-layer parity reference holds exactly through Stage 8.
      worldDrawHash: "fnv1a64:c55ac880b00ac4d0",
      // Bounded lag handling must not discard simulated time at the
      // deterministic 16 ms harness pacing.
      droppedSimTimeMs: 0,
      // The Stage 7 emission-cache browser gate holds unchanged.
      emitColumnRebuilds: 0,
      emitColumnHits: 2,
      emissionCacheSize: 2,
    },
    // Stage 8 authorizes no golden changes: final acceptance is cleanup
    // and documentation only.
    stageOwnedKeys: [
      "snapshotMatrix",
      "remnantCheck",
      "rustWorkspaceTests",
      "perfMedianVsStage7",
      "worldDrawHash",
      "worldStateHash",
      "droppedSimTimeMs",
      "worldDrawCmdCount",
      "finalAcceptanceMatrix",
      "toolAvailability",
      "denoTaskTest",
      "denoLint",
      "deadCodeCleanup",
      "docsUpdated",
      "perfFixtureCeiling",
    ],
  }],
]);
const spec = generatedStageSpecs.get(stage);
assert(stage === 0 || spec, `stage ${stage} has no validation profile`);
const requiredCommands = spec?.requiredCommands ?? stageZeroCommands;
for (const command of requiredCommands) {
  const result = checkpoint.commands.find((candidate) =>
    candidate.command === command
  );
  assert(result, `missing command result: ${command}`);
  assert(result.status === "PASS", `${command}: ${result.status}`);
  assert(result.evidence.length > 0, `${command}: missing evidence`);
  if (result.failed !== undefined) {
    assert(result.failed === 0, `${command}: failures`);
  }
  if (result.expectedExitCode !== undefined) {
    assert(
      result.actualExitCode === result.expectedExitCode,
      `${command}: unexpected exit code`,
    );
  }
}

if (stage === 0) {
  assert(
    JSON.stringify(checkpoint.snapshotCalls) === JSON.stringify({
      idle: 4,
      tick: 7,
      movement: 7,
      camera: 4,
      chat: 4,
    }),
    "Stage 0 snapshot matrix must be 4/7/7/4/4",
  );
  const perf = checkpoint.harnessPerformance;
  assert(perf.samplesMs.length >= 5, "expected at least five perf samples");
  assertMetric(perf.medianMs, percentile(perf.samplesMs, 0.5), "perf median");
  assertMetric(perf.p95Ms, percentile(perf.samplesMs, 0.95), "perf p95");
  assert(perf.medianMs < perf.ceilingMs, "perf median exceeds ceiling");
  assert(perf.ceilingMs === 6000, "Stage 0 ceiling must remain 6000 ms");
  assert(perf.semantics.floorQuadCount === 130, "floorQuadCount != 130");
  assert(perf.semantics.playerQuadCount === 1, "playerQuadCount != 1");
  assert(perf.semantics.atlasQuadCount === 131, "atlasQuadCount != 131");
  assert(perf.semantics.worldTick === 33, "unexpected Stage 0 world tick");
  assert(
    perf.semantics.worldStateHash === "fnv1a64:11f96a454cacdf3d",
    "unexpected Stage 0 world hash",
  );
  assert(perf.semantics.drawCount === 7, "unexpected Stage 0 draw count");
  assert(
    /^fnv1a64:[0-9a-f]{16}$/.test(perf.semantics.observedDrawHash),
    "invalid observed draw hash",
  );
  for (const [name, value] of Object.entries(perf.semantics)) {
    if (name.startsWith("dropped")) assert(value === 0, `${name} != 0`);
  }
  assert(checkpoint.authorizedDeferrals.length === 0, "Stage 0 has deferrals");
}

if (spec) {
  const label = `Stage ${stage}`;
  assert(
    checkpoint.generatedBy === spec.acceptTask,
    `${label} checkpoint was not generated by ${spec.acceptTask}`,
  );
  const requiredMatrix = spec.snapshotMatrix ??
    { idle: 1, tick: 1, movement: 1, camera: 1, chat: 1 };
  assert(
    Object.keys(checkpoint.snapshotCalls).length ===
      Object.keys(requiredMatrix).length,
    `${label} snapshot matrix path set mismatch`,
  );
  for (const [path, expected] of Object.entries(requiredMatrix)) {
    assert(
      checkpoint.snapshotCalls[path] === expected,
      `${label} snapshot path ${path}: recorded ${
        checkpoint.snapshotCalls[path]
      }, required ${expected}`,
    );
  }
  const perf = checkpoint.harnessPerformance;
  assert(
    perf.samplesMs.length >= 5,
    `${label} requires at least five perf samples`,
  );
  assertMetric(
    perf.medianMs,
    percentile(perf.samplesMs, 0.5),
    `${label} perf median`,
  );
  assertMetric(
    perf.p95Ms,
    percentile(perf.samplesMs, 0.95),
    `${label} perf p95`,
  );
  assert(
    perf.medianMs < perf.ceilingMs,
    `${label} perf median exceeds ceiling`,
  );
  if (spec.ceilingMs !== undefined) {
    assert(
      perf.ceilingMs === spec.ceilingMs,
      `${label} ceiling must be ${spec.ceilingMs} ms`,
    );
  }
  let allowedBaselineMedianMs: number;
  if ("medianMs" in spec.baseline) {
    allowedBaselineMedianMs = spec.baseline.medianMs;
  } else {
    const baselineEvidence = JSON.parse(
      await Deno.readTextFile(spec.baseline.evidencePath),
    ) as { medianMs: number; samplesMs: number[] };
    const spreadMs = spec.baseline.toleranceFromRecordedSpread
      ? Math.max(...baselineEvidence.samplesMs) -
        Math.min(...baselineEvidence.samplesMs)
      : 0;
    allowedBaselineMedianMs = baselineEvidence.medianMs + spreadMs;
  }
  assert(
    perf.medianMs <= allowedBaselineMedianMs,
    `${label} median regressed beyond ${spec.baseline.label} (allowed ${allowedBaselineMedianMs} ms)`,
  );
  assert(
    perf.semantics.floorQuadCount === 130,
    `${label} floorQuadCount != 130`,
  );
  assert(perf.semantics.playerQuadCount === 1, `${label} playerQuadCount != 1`);
  assert(
    perf.semantics.atlasQuadCount === 131,
    `${label} atlasQuadCount != 131`,
  );
  assert(perf.semantics.worldTick === 33, `${label} world tick mismatch`);
  const requiredWorldStateHash = spec.worldStateHash ??
    "fnv1a64:11f96a454cacdf3d";
  assert(
    perf.semantics.worldStateHash === requiredWorldStateHash,
    `${label} world hash mismatch: recorded ${perf.semantics.worldStateHash}, required ${requiredWorldStateHash}`,
  );
  assert(perf.semantics.drawCount === 7, `${label} draw count mismatch`);
  assert(
    /^fnv1a64:[0-9a-f]{16}$/.test(perf.semantics.observedDrawHash),
    `${label} draw hash malformed`,
  );
  const requiredSnapshotCallsLastFrame = spec.snapshotCallsLastFrame ?? 1;
  assert(
    perf.semantics.snapshotCallsLastFrame === requiredSnapshotCallsLastFrame,
    `${label} final snapshot count != ${requiredSnapshotCallsLastFrame}`,
  );
  for (const [name, expected] of Object.entries(spec.requiredSemantics ?? {})) {
    const actual = (perf.semantics as Record<string, unknown>)[name];
    assert(
      actual === expected,
      `${label} semantics ${name}: recorded ${
        JSON.stringify(actual)
      }, required ${JSON.stringify(expected)}`,
    );
  }
  for (const [name, value] of Object.entries(perf.semantics)) {
    if (name.startsWith("dropped")) {
      assert(value === 0, `${label} ${name} != 0`);
    }
  }
  assert(
    checkpoint.authorizedDeferrals.length === 0,
    `${label} has deferrals`,
  );

  if (spec.remnantCommand) {
    const remnant = checkpoint.commands.find((candidate) =>
      candidate.command === spec.remnantCommand
    );
    assert(remnant, `${label} remnant-check command missing`);
    assert(
      remnant.expectedExitCode === 1 && remnant.actualExitCode === 1,
      `${label} remnant check must record rg exit code 1 (no matches)`,
    );
  }
  if (spec.rustTests) {
    const rust = checkpoint.commands.find((candidate) =>
      candidate.command === spec.rustTests!.command
    );
    assert(rust, `${label} Rust workspace test command missing`);
    assert(
      typeof rust.passed === "number" &&
        rust.passed >= spec.rustTests.minimumPassed,
      `${label} Rust passed count below ${spec.rustTests.minimumPassed}`,
    );
    assert(rust.failed === 0, `${label} Rust workspace tests failed`);
  }
  for (const key of spec.stageOwnedKeys ?? []) {
    assert(
      checkpoint.stageOwned && key in checkpoint.stageOwned,
      `${label} stage-owned value missing: ${key}`,
    );
  }
  if (checkpoint.goldens.sha256ByFile) {
    for (
      const [path, sha256] of Object.entries(checkpoint.goldens.sha256ByFile)
    ) {
      assert(
        await fileSha256(path) === sha256,
        `golden ${path} disagrees with checkpoint`,
      );
    }
  }

  assert(
    checkpoint.snapshotEvidencePath,
    `${label} snapshot evidence path missing`,
  );
  const snapshotEvidence = JSON.parse(
    await Deno.readTextFile(checkpoint.snapshotEvidencePath),
  );
  assert(
    snapshotEvidence.stage === stage,
    `${label} snapshot evidence stage mismatch`,
  );
  assert(
    JSON.stringify(snapshotEvidence.snapshotCalls) ===
      JSON.stringify(checkpoint.snapshotCalls),
    `${label} snapshot evidence disagrees with checkpoint`,
  );
  assert(
    snapshotEvidence.artifact.profile === "debug",
    "snapshot evidence is not debug",
  );
  assert(
    snapshotEvidence.artifact.metadataSha256 ===
        checkpoint.artifacts.debug.generatedSha256 &&
      snapshotEvidence.artifact.servedSha256 ===
        checkpoint.artifacts.debug.servedSha256,
    "debug snapshot evidence provenance disagrees with checkpoint",
  );
  assert(
    snapshotEvidence.pathState.idleTick === 0,
    "idle path advanced the world",
  );
  assert(snapshotEvidence.pathState.tickDelta === 1, "tick path delta != 1");
  assert(
    snapshotEvidence.pathState.movementTickDelta === 1 &&
      snapshotEvidence.pathState.movementActive,
    "movement path did not advance with active movement",
  );
  assert(
    snapshotEvidence.pathState.cameraTickDelta === 0 &&
      snapshotEvidence.pathState.cameraMoved,
    "camera path state mismatch",
  );
  assert(
    snapshotEvidence.pathState.chatTickDelta === 0 &&
      snapshotEvidence.pathState.chatMode === "chat",
    "chat path state mismatch",
  );
  for (const [field, expected] of Object.entries(spec.pathState ?? {})) {
    assert(
      snapshotEvidence.pathState[field] === expected,
      `${label} pathState ${field}: recorded ${
        JSON.stringify(snapshotEvidence.pathState[field])
      }, required ${JSON.stringify(expected)}`,
    );
  }

  assert(perf.artifactPath, `${label} perf evidence path missing`);
  const perfEvidence = JSON.parse(await Deno.readTextFile(perf.artifactPath));
  assert(
    perfEvidence.stage === stage,
    `${label} perf evidence stage mismatch`,
  );
  assert(
    JSON.stringify(perfEvidence.samplesMs) === JSON.stringify(perf.samplesMs),
    `${label} perf samples disagree with evidence`,
  );
  assertMetric(
    perfEvidence.medianMs,
    perf.medianMs,
    `${label} evidence median`,
  );
  assertMetric(perfEvidence.p95Ms, perf.p95Ms, `${label} evidence p95`);
  assert(
    perfEvidence.ceilingMs === perf.ceilingMs,
    `${label} evidence ceiling mismatch`,
  );
  assert(
    JSON.stringify(perfEvidence.semantics) === JSON.stringify(perf.semantics),
    `${label} perf semantics disagree with evidence`,
  );
  assert(
    perfEvidence.artifact.profile === "release",
    "perf evidence is not release",
  );
  assert(
    perfEvidence.artifact.metadataSha256 ===
        checkpoint.artifacts.release.generatedSha256 &&
      perfEvidence.artifact.servedSha256 ===
        checkpoint.artifacts.release.servedSha256,
    "release perf evidence provenance disagrees with checkpoint",
  );

  const profileEvidence = JSON.parse(
    await Deno.readTextFile(checkpoint.sameRunProfile.artifactPath),
  );
  const assertProfileRoute = (
    recorded: RouteProfile,
    actual: {
      samples: number[];
      medianMs: number;
      p95Ms: number;
      gl: RouteProfile["gl"];
    },
    label: string,
  ) => {
    assert(
      JSON.stringify(recorded.samplesMs) === JSON.stringify(actual.samples),
      `${label} samples disagree with profile evidence`,
    );
    assertMetric(
      recorded.medianMs,
      actual.medianMs,
      `${label} evidence median`,
    );
    assertMetric(recorded.p95Ms, actual.p95Ms, `${label} evidence p95`);
    assert(
      JSON.stringify(recorded.gl) === JSON.stringify({
        vendor: actual.gl.vendor,
        renderer: actual.gl.renderer,
        rendererSource: actual.gl.rendererSource,
        errors: actual.gl.errors,
        contextLost: actual.gl.contextLost,
      }),
      `${label} GL evidence disagrees with checkpoint`,
    );
  };
  assertProfileRoute(
    checkpoint.sameRunProfile.webgl,
    profileEvidence.results["/webgl"],
    "/webgl",
  );
  assertProfileRoute(
    checkpoint.sameRunProfile.engine,
    profileEvidence.results["/engine"],
    "/engine",
  );
  assert(
    profileEvidence.results["/engine"].provenance.served.sha256 ===
      checkpoint.artifacts.release.servedSha256,
    "profile served release hash disagrees with checkpoint",
  );
}

assertRoute(checkpoint.sameRunProfile.webgl, "/webgl");
assertRoute(checkpoint.sameRunProfile.engine, "/engine");
await Deno.stat(checkpoint.sameRunProfile.artifactPath);
const authorizedGoldens = [...(spec?.authorizedGoldens ?? [])]
  .sort((a, b) => a.file.localeCompare(b.file));
if (authorizedGoldens.length === 0) {
  assert(checkpoint.goldens.changedFiles.length === 0, "golden files changed");
} else {
  assert(
    JSON.stringify([...checkpoint.goldens.changedFiles].sort()) ===
      JSON.stringify(authorizedGoldens.map((golden) => golden.file)),
    `stage ${stage} changed goldens must be exactly the authorized list [${
      authorizedGoldens.map((golden) => golden.file).join(", ")
    }]`,
  );
  assert(
    checkpoint.goldens.authorizedStage === stage,
    `golden re-blesses must record authorized stage ${stage}`,
  );
  for (const expected of authorizedGoldens) {
    const record = (checkpoint.goldens.changed ?? []).find((candidate) =>
      candidate.file === expected.file
    );
    assert(record, `golden rebless record missing: ${expected.file}`);
    assert(
      record.beforeSha256 === expected.beforeSha256,
      `golden ${expected.file} before hash: recorded ${record.beforeSha256}, required ${expected.beforeSha256}`,
    );
    assert(
      record.afterSha256 === expected.afterSha256,
      `golden ${expected.file} after hash: recorded ${record.afterSha256}, required ${expected.afterSha256}`,
    );
    assert(
      record.reason.length > 0,
      `golden ${expected.file} is missing a re-bless reason`,
    );
    assert(
      await fileSha256(expected.file) === expected.afterSha256,
      `golden ${expected.file} on disk disagrees with the authorized after hash`,
    );
  }
}
assert(checkpoint.goldens.reason.length > 0, "missing golden status reason");
assert(checkpoint.residualRisks.length > 0, "missing residual risks");

console.log(
  `Stage ${stage} checkpoint valid: ${
    checkpoint.reviewedImplementation.workspaceDiffSha256 ??
      checkpoint.reviewedImplementation.contentSha256 ??
      checkpoint.reviewedImplementation.head
  }`,
);
