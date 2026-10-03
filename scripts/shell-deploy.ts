// The rules of a Shell deploy (CONTEXT.md), separated from the commands that carry them out so
// tests can stub every command. `scripts/deploy.ts` supplies the real commands.
//
// A Shell deploy is refused when the working tree is dirty or when `od-prod` has a pending
// migration: the shell never runs a migration itself (`deno task db:migrate:prod`), and a deploy
// that needs a table `od-prod` lacks fails on every request. A deploy is recorded in the store
// only after the deploy command succeeds and reports a Deno revision id.

import type { Store } from "../src/server/store.ts";

export const ORG = "legoguy32109";
export const APP = "opendwarf";
/** Pinned the way learn pins it; the CLI rewrites deno.json when it runs. */
export const DEPLOY_CLI = "jsr:@deno/deploy@0.0.9904";

export interface DeployResult {
  success: boolean;
  code: number;
  /** What the CLI printed with `--json`. */
  stdout: string;
}

/** Every command the deploy runs. Tests replace them. */
export interface DeployCommands {
  /** `git status --porcelain` lines; empty when the tree is clean. */
  dirtyFiles(): Promise<string[]>;
  /** The full SHA of HEAD. */
  headCommit(): Promise<string>;
  /**
   * Versions this checkout carries that `od-prod` has not applied, or null when `od-prod` cannot
   * be asked because `.env.prod` is missing.
   */
  pendingProductionMigrations(): Promise<string[] | null>;
  /** The files that would be uploaded, before exclusions. */
  trackedFiles(): Promise<string[]>;
  /** The `deploy.exclude` entries of deno.json. */
  excludes(): Promise<string[]>;
  /** Runs the deploy CLI and puts deno.json back the way it found it. */
  deploy(args: string[]): Promise<DeployResult>;
  /** The store of `od-prod`. Not called in a dry run. */
  store(): Store;
}

export interface DeployOptions {
  dryRun: boolean;
  note: string;
  hasToken: boolean;
}

export class DeployRefused extends Error {}

/** The arguments of the deploy CLI. */
export function deployArgs(): string[] {
  return [
    "run",
    "-A",
    "--no-lock",
    DEPLOY_CLI,
    "--json",
    "--non-interactive",
    "--org",
    ORG,
    "--app",
    APP,
    "--prod",
    ".",
  ];
}

/** True when a deploy.exclude entry removes `path`. An entry is a path prefix or a `*` pattern. */
export function isExcluded(path: string, excludes: string[]): boolean {
  return excludes.some((entry) => {
    const bare = entry.replace(/^\.\//, "").replace(/\/$/, "");
    if (bare.includes("*")) {
      const pattern = bare.split("*").map((part) =>
        part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      ).join("[^/]*");
      return new RegExp(`^${pattern}$`).test(path);
    }
    return path === bare || path.startsWith(`${bare}/`);
  });
}

/** The revision id and production URL in the last JSON line the CLI printed. */
export function parseDeployOutput(
  stdout: string,
): { revisionId?: string; productionUrl?: string } {
  try {
    const parsed: unknown = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    return {
      revisionId: typeof record.revisionId === "string" && record.revisionId
        ? record.revisionId
        : undefined,
      productionUrl: typeof record.productionUrl === "string"
        ? record.productionUrl
        : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Checks the refusal rules, then deploys and records. A dry run checks and prints, and runs no
 * deploy and writes no record. Returns the lines to print.
 */
export async function runShellDeploy(
  commands: DeployCommands,
  options: DeployOptions,
): Promise<string[]> {
  if (!options.dryRun && !options.hasToken) {
    throw new DeployRefused("DENO_DEPLOY_TOKEN must be set; load .env.prod");
  }
  const dirty = await commands.dirtyFiles();
  if (dirty.length) {
    throw new DeployRefused(
      `Refusing to deploy: the working tree is dirty (${dirty.length} path(s)). ` +
        `Commit or stash first, so the record names the commit that was deployed.\n${
          dirty.slice(0, 10).join("\n")
        }`,
    );
  }
  const pending = await commands.pendingProductionMigrations();
  if (pending === null && !options.dryRun) {
    throw new DeployRefused(
      "Refusing to deploy: .env.prod is missing, so od-prod's migrations cannot be checked.",
    );
  }
  if (pending?.length) {
    throw new DeployRefused(
      `Refusing to deploy: od-prod has not applied ${pending.length} migration(s) this checkout carries: ${
        pending.join(", ")
      }.\nRun \`deno task db:migrate:prod\` first, then deploy again.`,
    );
  }
  const commit = await commands.headCommit();

  if (options.dryRun) {
    const excludes = await commands.excludes();
    const files = (await commands.trackedFiles())
      .filter((path) => !isExcluded(path, excludes));
    return [
      `Dry run: nothing is deployed or recorded.`,
      pending === null
        ? `Migration check skipped: .env.prod is missing. A real deploy refuses without it.`
        : `Migration check: od-prod has no pending migration.`,
      `Would deploy commit ${commit} to ${APP} in ${ORG} as production.`,
      `Command: deno ${deployArgs().join(" ")}`,
      `Upload: ${files.length} tracked file(s) (the CLI also honors .gitignore); excluded: ${
        excludes.join(", ") || "(none)"
      }.`,
      ...files.map((path) => `  ${path}`),
      `Would record a Shell deploy: commit ${commit}, Deno revision from the CLI's --json output, note ${
        JSON.stringify(options.note)
      }.`,
    ];
  }

  const result = await commands.deploy(deployArgs());
  if (!result.success) {
    throw new Error(
      `deno deploy exited with ${result.code}; no Shell deploy was recorded.\n${result.stdout}`,
    );
  }
  const { revisionId, productionUrl } = parseDeployOutput(result.stdout);
  if (!revisionId) {
    throw new Error(
      `The deploy succeeded but the CLI printed no revision id, so no Shell deploy was recorded.\n${result.stdout}`,
    );
  }
  const record = await commands.store().recordShellDeploy({
    commit,
    denoRevision: revisionId,
    note: options.note,
  });
  return [
    `Deployed revision ${revisionId}${
      productionUrl ? ` to ${productionUrl}` : ""
    }.`,
    `Recorded Shell deploy: commit ${record.commit}, revision ${record.denoRevision}.`,
  ];
}
