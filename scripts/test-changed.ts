// Runs only the tests a diff can affect.
//
//   deno task test:changed [--base main] [--e2e] [--list]
//
// Fallow's import graph gives every file that depends on a changed file, so the
// unit tests are exact. A browser spec imports almost nothing from `src/`, so
// `tests/e2e/impact.json` maps source prefixes to specs. A changed client or
// shared file with no rule runs every spec. `--list` prints the choice only.
const FALLOW = "fallow@3.33.1";
const UNIT = /^tests\/(shared|client|server|lint)\/[^/]+_test\.ts$/;
const SPEC = /^tests\/e2e\/[^/]+\.spec\.ts$/;
const SOURCE = /\.(js|ts|html|css)$/;
/** A change here can alter every test. */
const EVERYTHING = ["deno.json", "deno.lock", "playwright.config.ts"];
/** A change here reaches the browser through no import, so a spec needs a rule. */
const BROWSER = ["src/client/", "src/shared/", "public/"];

export interface Rule {
  when: string[];
  specs: string[];
}

export interface Selection {
  unit: string[] | "all";
  e2e: string[] | "all";
  reasons: string[];
}

/**
 * Chooses tests for changed files. `dependents` answers with the files that
 * import a file, directly or not, or null when the graph does not know it
 * (a deleted file).
 */
export async function selectTests(
  changed: string[],
  dependents: (file: string) => Promise<string[] | null>,
  rules: Rule[],
): Promise<Selection> {
  const unit = new Set<string>();
  const e2e = new Set<string>();
  const reasons: string[] = [];
  let allUnit = false;
  let allE2e = false;
  for (const file of changed) {
    if (EVERYTHING.includes(file)) {
      reasons.push(`${file} changed: every test`);
      allUnit = allE2e = true;
      continue;
    }
    if (!SOURCE.test(file)) continue;
    const reach = await dependents(file);
    if (reach === null) {
      reasons.push(`${file} is not in the import graph: every unit test`);
      allUnit = true;
    }
    for (const path of [file, ...(reach ?? [])]) {
      if (UNIT.test(path)) unit.add(path);
      if (SPEC.test(path)) e2e.add(path);
    }
    const ruled = rules.filter((r) => r.when.some((p) => file.startsWith(p)));
    for (const rule of ruled) {
      for (const spec of rule.specs) e2e.add(`tests/e2e/${spec}`);
    }
    if (!ruled.length && BROWSER.some((p) => file.startsWith(p))) {
      reasons.push(`${file} has no rule in tests/e2e/impact.json: every spec`);
      allE2e = true;
    }
  }
  return {
    unit: allUnit ? "all" : [...unit].sort(),
    e2e: allE2e ? "all" : [...e2e].sort(),
    reasons,
  };
}

async function run(cmd: string[], env?: Record<string, string>) {
  const out = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    env,
    stdout: "piped",
    stderr: "null",
  }).output();
  return new TextDecoder().decode(out.stdout);
}

/** Files changed from the merge base with `base` to the working tree. */
async function changedFiles(base: string): Promise<string[]> {
  const mergeBase = (await run(["git", "merge-base", base, "HEAD"])).trim();
  const tracked = await run(["git", "diff", "--name-only", mergeBase]);
  const fresh = await run(["git", "ls-files", "-o", "--exclude-standard"]);
  return [...new Set(`${tracked}\n${fresh}`.split("\n").filter(Boolean))];
}

/** Fallow's dependents of one file, or null when the file is gone. */
async function fallowDependents(file: string): Promise<string[] | null> {
  try {
    await Deno.stat(file);
  } catch {
    return null;
  }
  const text = await run([
    "npx",
    "--yes",
    FALLOW,
    "inspect",
    "--file",
    file,
    "--format",
    "json",
  ]);
  try {
    const closure = JSON.parse(text).evidence.impact_closure;
    return closure.data?.affected_not_shown ?? closure.data?.affected ?? [];
  } catch {
    return null;
  }
}

async function main() {
  const args = Deno.args;
  const base = args.includes("--base")
    ? args[args.indexOf("--base") + 1]
    : "main";
  Deno.chdir(new URL("..", import.meta.url));
  const rules: Rule[] = JSON.parse(
    await Deno.readTextFile("tests/e2e/impact.json"),
  );
  const changed = await changedFiles(base);
  const selection = await selectTests(changed, fallowDependents, rules);
  const unit = selection.unit === "all"
    ? ["tests/lint", "tests/shared", "tests/client", "tests/server"]
    : selection.unit;
  const withE2e = args.includes("--e2e");
  for (const reason of selection.reasons) console.log(reason);
  console.log(`${changed.length} files changed against ${base}`);
  console.log(`unit: ${selection.unit === "all" ? "all" : unit.length} files`);
  console.log(
    `e2e: ${selection.e2e === "all" ? "all" : selection.e2e.length} specs` +
      (withE2e ? "" : " (add --e2e to run)"),
  );
  if (args.includes("--list")) {
    for (const f of unit) console.log(`  ${f}`);
    if (selection.e2e !== "all") {
      for (const f of selection.e2e) console.log(`  ${f}`);
    }
    return;
  }
  let failed = false;
  if (unit.length) {
    const code = (await new Deno.Command("deno", {
      args: [
        "test",
        "--allow-read",
        "--allow-net",
        "--allow-env",
        ...unit,
      ],
      stdout: "inherit",
      stderr: "inherit",
    }).output()).code;
    failed ||= code !== 0;
  }
  const specs = selection.e2e === "all" ? [] : selection.e2e;
  if (withE2e && (selection.e2e === "all" || specs.length)) {
    const code = (await new Deno.Command("deno", {
      args: ["task", "e2e", ...specs],
      stdout: "inherit",
      stderr: "inherit",
    }).output()).code;
    failed ||= code !== 0;
  }
  if (failed) Deno.exit(1);
}

if (import.meta.main) await main();
