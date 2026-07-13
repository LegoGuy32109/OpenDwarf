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
  reviewedImplementation: {
    mode: "worktree" | "commit";
    head: string;
    workspaceDiffSha256: string | null;
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
  snapshotCalls: {
    idle: number;
    tick: number;
    movement: number;
    camera: number;
    chat: number;
  };
  harnessPerformance: {
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
    };
  };
  sameRunProfile: {
    artifactPath: string;
    webgl: RouteProfile;
    engine: RouteProfile;
  };
  goldens: {
    changedFiles: string[];
    reason: string;
  };
  authorizedDeferrals: string[];
  residualRisks: string[];
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

const requiredCommands = [
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

assertRoute(checkpoint.sameRunProfile.webgl, "/webgl");
assertRoute(checkpoint.sameRunProfile.engine, "/engine");
await Deno.stat(checkpoint.sameRunProfile.artifactPath);
assert(checkpoint.goldens.changedFiles.length === 0, "golden files changed");
assert(checkpoint.goldens.reason.length > 0, "missing golden status reason");
assert(checkpoint.residualRisks.length > 0, "missing residual risks");

console.log(
  `Stage ${stage} checkpoint valid: ${
    checkpoint.reviewedImplementation.workspaceDiffSha256 ??
      checkpoint.reviewedImplementation.head
  }`,
);
