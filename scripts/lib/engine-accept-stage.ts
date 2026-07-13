import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const EVIDENCE_DIR = "docs/design/checkpoints/evidence";
// Stage 0 discovered 17 Playwright tests; an unexplained decrease is a red
// gate. Exactly one test (the env-gated perf file) is expected to skip.
const STAGE_0_PLAYWRIGHT_DISCOVERED = 17;

export type CommandRecord = {
  command: string;
  status: "PASS";
  discovered?: number;
  passed?: number;
  failed: number;
  skipped?: number;
  expectedExitCode?: number;
  actualExitCode?: number;
  evidence: string;
};

type ProfileRoute = {
  samples: number[];
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

export type PerfEvidence = {
  stage: number;
  samplesMs: number[];
  medianMs: number;
  p95Ms: number;
  ceilingMs: number;
  semantics: Record<string, unknown>;
};

export type RemnantResult = {
  command: string;
  expectedExitCode: 1;
  actualExitCode: number;
};

export type GoldenRebless = {
  file: string;
  beforeSha256: string;
  afterSha256: string;
  reason: string;
};

export type ProfileEvidence = {
  chromium: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  results: Record<string, ProfileRoute>;
};

export type StageOwnedContext = {
  rustCounts: { passed: number; failed: number };
  unitCounts: { passed: number; failed: number };
  playwrightCounts: {
    discovered: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  perf: PerfEvidence;
  baselinePerf: {
    label: string;
    evidencePath: string;
    medianMs: number;
    recordedSpreadMs?: number;
    allowedMedianMs: number;
  };
  // Same-run RAF profile written by `deno task engine:perf` during this
  // acceptance run (both routes, GL identity/health, environment).
  profile: ProfileEvidence;
  remnant?: RemnantResult;
  snapshotCalls: Record<string, number>;
  goldens: GoldenRebless[];
};

export type StageAcceptanceConfig = {
  stage: number;
  // `cargo test --workspace` passing floor; a decrease below it is a red gate.
  rustPassedFloor: { label: string; passed: number };
  // Previous-stage perf evidence whose recorded median must not regress.
  // `toleranceFromRecordedSpread` allows the median to exceed the baseline
  // median by at most the baseline evidence's own recorded sample spread
  // (max - min): "no worse beyond normal recorded variance". The tolerance
  // is derived from recorded evidence, never an arbitrary constant, and is
  // strict (zero tolerance) when omitted.
  baselinePerf: {
    label: string;
    evidencePath: string;
    toleranceFromRecordedSpread?: boolean;
  };
  // Optional `rg` remnant check that must exit 1 (no matches).
  remnant?: { pattern: string; searchPath: string; evidence: string };
  // Exact snapshot calls required on every recorded frame path (default 1).
  expectedSnapshotCallsPerPath?: number;
  // Exact release perf harness ceiling the evidence must record, when pinned.
  requiredCeilingMs?: number;
  // Exact stage-owned values required in the release perf harness semantics.
  requiredSemantics?: Record<string, string | number>;
  // Golden files this stage authorizes for re-blessing, with the exact
  // expected before (HEAD) and after (working tree) SHA-256 per file. The
  // observed golden diff must match this list exactly; an empty/omitted list
  // requires zero golden changes.
  authorizedGoldens?: GoldenRebless[];
  goldensReason: string;
  // Additional command records the stage script executed itself before
  // invoking the shared lanes (e.g. Stage 8's `deno task engine:build`,
  // `deno task test`, and `deno lint`); appended verbatim to the checkpoint
  // command list. The stage script owns their gating.
  extraCommands?: CommandRecord[];
  buildStageOwned: (context: StageOwnedContext) => Record<string, unknown>;
  residualRisks: string[];
};

async function writeAll(
  writer: { write(p: Uint8Array): Promise<number> },
  data: Uint8Array,
) {
  let written = 0;
  while (written < data.length) {
    written += await writer.write(data.subarray(written));
  }
}

async function runCapture(
  command: string,
  args: string[],
  label: string,
  env: Record<string, string> = {},
): Promise<string> {
  console.log(`\n==> ${label}`);
  const child = new Deno.Command(command, {
    args,
    env,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const captured: string[] = [];
  const pump = async (
    stream: ReadableStream<Uint8Array>,
    sink: { write(p: Uint8Array): Promise<number> },
  ) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      captured.push(decoder.decode(chunk, { stream: true }));
      await writeAll(sink, chunk);
    }
    captured.push(decoder.decode());
  };
  const [status] = await Promise.all([
    child.status,
    pump(child.stdout, Deno.stdout),
    pump(child.stderr, Deno.stderr),
  ]);
  if (!status.success) {
    throw new Error(`${label} failed with exit code ${status.code}`);
  }
  return captured.join("");
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
  return new TextDecoder().decode(output.stdout).trim();
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

// SHA-256 of a blob as committed at `rev`, without trimming (a trimmed
// string digest would not match `sha256sum` for newline-terminated files).
async function gitShowSha256(rev: string, path: string) {
  const output = await new Deno.Command("git", {
    args: ["show", `${rev}:${path}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  return createHash("sha256").update(output.stdout).digest("hex");
}

async function readJson(path: string) {
  return JSON.parse(await Deno.readTextFile(path));
}

async function artifact(profile: "debug" | "release", servedSha256: string) {
  const metadata = await readJson("engine/generated/od_wasm.build.json");
  if (metadata.profile !== profile) {
    throw new Error(`expected ${profile} metadata, got ${metadata.profile}`);
  }
  const generatedSha256 = await sha256("engine/generated/od_wasm_bg.wasm");
  const staticSha256 = await sha256("static/engine/od_wasm_bg.wasm");
  if (
    generatedSha256 !== metadata.wasm.sha256 ||
    staticSha256 !== metadata.wasm.sha256 ||
    servedSha256 !== metadata.wasm.sha256
  ) {
    throw new Error(
      `${profile} generated/static/metadata/served hashes disagree`,
    );
  }
  return {
    profile,
    metadataPath: "engine/generated/od_wasm.build.json",
    generatedSha256,
    staticSha256,
    servedSha256,
  };
}

function parseCargoCounts(output: string) {
  let passed = 0;
  let failed = 0;
  let suites = 0;
  for (
    const match of output.matchAll(
      /test result: \w+\. (\d+) passed; (\d+) failed;/g,
    )
  ) {
    passed += Number(match[1]);
    failed += Number(match[2]);
    suites += 1;
  }
  if (suites === 0) throw new Error("no cargo test result lines found");
  return { passed, failed };
}

function parseDenoTestCounts(output: string) {
  const match = output.match(
    /(\d+) passed(?: \(\d+ steps?\))? \| (\d+) failed/,
  );
  if (!match) throw new Error("no deno test summary found");
  return { passed: Number(match[1]), failed: Number(match[2]) };
}

function parsePlaywrightCounts(output: string) {
  const discovered = output.match(/Running (\d+) tests? using/);
  const passed = output.match(/(\d+) passed/);
  const failed = output.match(/(\d+) failed/);
  const skipped = output.match(/(\d+) skipped/);
  if (!discovered || !passed) {
    throw new Error("could not parse Playwright discovery/pass counts");
  }
  return {
    discovered: Number(discovered[1]),
    passed: Number(passed[1]),
    failed: failed ? Number(failed[1]) : 0,
    skipped: skipped ? Number(skipped[1]) : 0,
  };
}

export async function runStageAcceptance(config: StageAcceptanceConfig) {
  const STAGE = config.stage;
  const ACCEPT_TASK = `deno task engine:accept-stage${STAGE}`;
  const CHECKPOINT =
    `docs/design/checkpoints/engine-render-hot-path-stage-${STAGE}.json`;
  const SNAPSHOT_REPORT =
    `${EVIDENCE_DIR}/engine-render-hot-path-stage-${STAGE}-debug.json`;
  const PERF_REPORT =
    `${EVIDENCE_DIR}/engine-render-hot-path-stage-${STAGE}-perf.json`;
  const PROFILE_REPORT =
    `${EVIDENCE_DIR}/engine-render-hot-path-stage-${STAGE}-profile.json`;

  const run = async (
    command: string,
    args: string[],
    label: string,
    env: Record<string, string> = {},
  ): Promise<CommandRecord> => {
    await runCapture(command, args, label, env);
    return {
      command: label,
      status: "PASS",
      failed: 0,
      evidence: `generated by ${ACCEPT_TASK}`,
    };
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });

  const commands: CommandRecord[] = [];

  const cargoOutput = await runCapture(
    "deno",
    ["task", "engine:test"],
    "deno task engine:test",
  );
  const rustCounts = parseCargoCounts(cargoOutput);
  if (rustCounts.failed !== 0) {
    throw new Error(`Rust workspace tests failed: ${rustCounts.failed}`);
  }
  if (rustCounts.passed < config.rustPassedFloor.passed) {
    throw new Error(
      `Rust passed count ${rustCounts.passed} decreased below ${config.rustPassedFloor.label}'s ${config.rustPassedFloor.passed}`,
    );
  }
  commands.push({
    command: "deno task engine:test",
    status: "PASS",
    passed: rustCounts.passed,
    failed: rustCounts.failed,
    evidence:
      `cargo test --workspace: ${rustCounts.passed} passed, ${rustCounts.failed} failed (${config.rustPassedFloor.label} floor ${config.rustPassedFloor.passed})`,
  });

  commands.push(
    await run("deno", ["task", "engine:check"], "deno task engine:check"),
  );
  commands.push(
    await run("deno", ["task", "engine:dev"], "deno task engine:dev"),
  );

  const unitOutput = await runCapture(
    "deno",
    ["task", "unit"],
    "deno task unit",
  );
  const unitCounts = parseDenoTestCounts(unitOutput);
  if (unitCounts.failed !== 0) {
    throw new Error(`deno unit tests failed: ${unitCounts.failed}`);
  }
  commands.push({
    command: "deno task unit",
    status: "PASS",
    passed: unitCounts.passed,
    failed: unitCounts.failed,
    evidence:
      `deno test tests/unit/: ${unitCounts.passed} passed, ${unitCounts.failed} failed`,
  });

  const playwrightOutput = await runCapture(
    "bash",
    ["-lc", "npx playwright test tests/engine*.test.ts --workers=1"],
    "npx playwright test tests/engine*.test.ts --workers=1",
    {
      ENGINE_EXPECTED_PROFILE: "debug",
      ENGINE_SNAPSHOT_REPORT_PATH: SNAPSHOT_REPORT,
      ENGINE_REPORT_STAGE: String(STAGE),
    },
  );
  const playwrightCounts = parsePlaywrightCounts(playwrightOutput);
  if (playwrightCounts.failed !== 0) {
    throw new Error(`Playwright failures: ${playwrightCounts.failed}`);
  }
  if (playwrightCounts.discovered < STAGE_0_PLAYWRIGHT_DISCOVERED) {
    throw new Error(
      `Playwright discovered ${playwrightCounts.discovered} tests, below Stage 0's ${STAGE_0_PLAYWRIGHT_DISCOVERED}`,
    );
  }
  if (playwrightCounts.skipped !== 1) {
    throw new Error(
      `expected exactly one env-gated skip, got ${playwrightCounts.skipped}`,
    );
  }
  if (
    playwrightCounts.passed !==
      playwrightCounts.discovered - playwrightCounts.skipped
  ) {
    throw new Error("Playwright passed count does not cover discovery");
  }
  commands.push({
    command: "npx playwright test tests/engine*.test.ts --workers=1",
    status: "PASS",
    discovered: playwrightCounts.discovered,
    passed: playwrightCounts.passed,
    failed: playwrightCounts.failed,
    skipped: playwrightCounts.skipped,
    evidence:
      `engine suite: ${playwrightCounts.discovered} discovered, ${playwrightCounts.passed} passed, ${playwrightCounts.skipped} env-gated skip`,
  });

  const snapshot = await readJson(SNAPSHOT_REPORT);
  if (snapshot.stage !== STAGE) {
    throw new Error("snapshot evidence stage mismatch");
  }
  const expectedSnapshotCalls = config.expectedSnapshotCallsPerPath ?? 1;
  for (const [path, calls] of Object.entries(snapshot.snapshotCalls)) {
    if (calls !== expectedSnapshotCalls) {
      throw new Error(
        `snapshot path ${path} recorded ${calls} calls, want ${expectedSnapshotCalls}`,
      );
    }
  }
  const debugArtifact = await artifact("debug", snapshot.artifact.servedSha256);

  let remnant: RemnantResult | undefined;
  if (config.remnant) {
    const remnantCommand =
      `rg "${config.remnant.pattern}" ${config.remnant.searchPath}`;
    console.log(`\n==> ${remnantCommand}`);
    const output = await new Deno.Command("rg", {
      args: [config.remnant.pattern, config.remnant.searchPath],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (output.code !== 1) {
      throw new Error(
        `remnant check expected rg exit 1 (no matches), got ${output.code}:\n${
          new TextDecoder().decode(output.stdout)
        }${new TextDecoder().decode(output.stderr)}`,
      );
    }
    console.log("no remnant matches (rg exit 1)");
    remnant = {
      command: remnantCommand,
      expectedExitCode: 1,
      actualExitCode: output.code,
    };
    commands.push({
      command: remnantCommand,
      status: "PASS",
      failed: 0,
      expectedExitCode: 1,
      actualExitCode: output.code,
      evidence: config.remnant.evidence,
    });
  }

  commands.push(
    await run(
      "deno",
      ["task", "engine:test-perf-browser"],
      "deno task engine:test-perf-browser",
      {
        ENGINE_PERF_REPORT_PATH: PERF_REPORT,
        ENGINE_REPORT_STAGE: String(STAGE),
      },
    ),
  );
  const perf = await readJson(PERF_REPORT) as PerfEvidence;
  if (perf.stage !== STAGE) throw new Error("perf evidence stage mismatch");
  if (
    config.requiredCeilingMs !== undefined &&
    perf.ceilingMs !== config.requiredCeilingMs
  ) {
    throw new Error(
      `perf evidence ceiling ${perf.ceilingMs} ms != required ${config.requiredCeilingMs} ms`,
    );
  }
  const baselinePerfEvidence = await readJson(config.baselinePerf.evidencePath);
  const baselineSpreadMs = config.baselinePerf.toleranceFromRecordedSpread
    ? Math.max(...baselinePerfEvidence.samplesMs) -
      Math.min(...baselinePerfEvidence.samplesMs)
    : 0;
  const allowedMedianMs = baselinePerfEvidence.medianMs + baselineSpreadMs;
  if (perf.medianMs > allowedMedianMs) {
    throw new Error(
      `Stage ${STAGE} median ${perf.medianMs} ms regressed beyond ${config.baselinePerf.label} median ${baselinePerfEvidence.medianMs} ms + recorded spread ${baselineSpreadMs} ms`,
    );
  }
  console.log(
    `Stage ${STAGE} median ${
      perf.medianMs.toFixed(1)
    } ms <= ${config.baselinePerf.label} median ${
      baselinePerfEvidence.medianMs.toFixed(1)
    } ms${
      config.baselinePerf.toleranceFromRecordedSpread
        ? ` + recorded spread ${baselineSpreadMs.toFixed(1)} ms`
        : ""
    }`,
  );
  for (
    const [name, expected] of Object.entries(config.requiredSemantics ?? {})
  ) {
    const actual = perf.semantics[name];
    if (actual !== expected) {
      throw new Error(
        `perf semantics ${name}: recorded ${JSON.stringify(actual)}, required ${
          JSON.stringify(expected)
        }`,
      );
    }
    console.log(`perf semantics ${name} == ${JSON.stringify(expected)}`);
  }

  commands.push(
    await run(
      "deno",
      ["task", "engine:perf"],
      "deno task engine:perf",
      { ENGINE_PERF_OUTPUT: PROFILE_REPORT },
    ),
  );
  commands.push(...(config.extraCommands ?? []));
  const profile = await readJson(PROFILE_REPORT);
  const releaseArtifact = await artifact(
    "release",
    profile.results["/engine"].provenance.served.sha256,
  );

  const goldenFiles = (await git([
    "ls-files",
    "tests/goldens",
    "game_engine/od_ui/goldens",
    "game_engine/od_world/goldens",
  ]))
    .split("\n").filter(Boolean).sort();
  const changedGoldens = (await git([
    "diff",
    "--name-only",
    "--",
    "tests/goldens",
    "game_engine/od_ui/goldens",
    "game_engine/od_world/goldens",
  ]))
    .split("\n").filter(Boolean).sort();
  const authorizedGoldens = [...(config.authorizedGoldens ?? [])]
    .sort((a, b) => a.file.localeCompare(b.file));
  const authorizedGoldenFiles = authorizedGoldens.map((golden) => golden.file);
  if (
    JSON.stringify(changedGoldens) !== JSON.stringify(authorizedGoldenFiles)
  ) {
    throw new Error(
      `changed goldens [${changedGoldens.join(", ")}] do not match the ` +
        `authorized Stage ${STAGE} list [${authorizedGoldenFiles.join(", ")}]`,
    );
  }
  for (const golden of authorizedGoldens) {
    const beforeSha256 = await gitShowSha256("HEAD", golden.file);
    if (beforeSha256 !== golden.beforeSha256) {
      throw new Error(
        `golden ${golden.file} HEAD hash ${beforeSha256} != authorized before hash ${golden.beforeSha256}`,
      );
    }
    const afterSha256 = await sha256(golden.file);
    if (afterSha256 !== golden.afterSha256) {
      throw new Error(
        `golden ${golden.file} working-tree hash ${afterSha256} != authorized after hash ${golden.afterSha256}`,
      );
    }
    console.log(
      `golden rebless verified: ${golden.file} ${golden.beforeSha256} -> ${golden.afterSha256}`,
    );
  }
  const goldenSha256ByFile = Object.fromEntries(
    await Promise.all(
      goldenFiles.map(async (path) => [path, await sha256(path)]),
    ),
  );

  const route = (value: ProfileRoute) => ({
    samplesMs: value.samples,
    medianMs: value.medianMs,
    p95Ms: value.p95Ms,
    gl: {
      vendor: value.gl.vendor,
      renderer: value.gl.renderer,
      rendererSource: value.gl.rendererSource,
      errors: value.gl.errors,
      contextLost: value.gl.contextLost,
    },
  });

  const head = await git(["rev-parse", "HEAD"]);
  const digestOutput = await new Deno.Command("deno", {
    args: [
      "task",
      "engine:validate-hot-path-checkpoint",
      "--print-content-sha",
      "--stage",
      String(STAGE),
    ],
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (!digestOutput.success) {
    throw new Error("failed to compute repository content digest");
  }
  const contentSha256 = new TextDecoder().decode(digestOutput.stdout).trim()
    .split("\n").at(-1)!;

  const checkpoint = {
    schemaVersion: 1,
    stage: STAGE,
    status: "PASS",
    generatedBy: ACCEPT_TASK,
    reviewedImplementation: {
      mode: "content",
      head,
      workspaceDiffSha256: null,
      contentSha256,
    },
    artifacts: { debug: debugArtifact, release: releaseArtifact },
    environment: profile.viewport
      ? { chromium: profile.chromium, viewport: profile.viewport }
      : undefined,
    commands,
    snapshotCalls: snapshot.snapshotCalls,
    snapshotEvidencePath: SNAPSHOT_REPORT,
    harnessPerformance: { ...perf, artifactPath: PERF_REPORT },
    sameRunProfile: {
      artifactPath: PROFILE_REPORT,
      webgl: route(profile.results["/webgl"]),
      engine: route(profile.results["/engine"]),
    },
    goldens: {
      changedFiles: authorizedGoldenFiles,
      ...(authorizedGoldens.length > 0
        ? { authorizedStage: STAGE, changed: authorizedGoldens }
        : {}),
      reason: config.goldensReason,
      sha256ByFile: goldenSha256ByFile,
    },
    stageOwned: config.buildStageOwned({
      rustCounts,
      unitCounts,
      playwrightCounts,
      perf,
      baselinePerf: {
        label: config.baselinePerf.label,
        evidencePath: config.baselinePerf.evidencePath,
        medianMs: baselinePerfEvidence.medianMs,
        ...(config.baselinePerf.toleranceFromRecordedSpread
          ? { recordedSpreadMs: baselineSpreadMs }
          : {}),
        allowedMedianMs,
      },
      profile: profile as ProfileEvidence,
      remnant,
      snapshotCalls: snapshot.snapshotCalls,
      goldens: authorizedGoldens,
    }),
    authorizedDeferrals: [],
    residualRisks: config.residualRisks,
  };

  await writeFile(CHECKPOINT, `${JSON.stringify(checkpoint, null, 2)}\n`);
  await run(
    "deno",
    ["task", "engine:validate-hot-path-checkpoint", "--stage", String(STAGE)],
    `deno task engine:validate-hot-path-checkpoint --stage ${STAGE}`,
  );
  console.log(`\nStage ${STAGE} acceptance complete: ${CHECKPOINT}`);
}
