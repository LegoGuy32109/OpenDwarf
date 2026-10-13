// Runs only the tests a diff can affect.
//
//   deno task test:changed [--base main] [--e2e]
//
// `deno test --changed` follows the module graph from each unit test, so it
// picks those. A browser spec imports almost nothing from `src/`, so
// `tests/e2e/impact.json` maps source prefixes to specs. A changed file with no
// rule runs every spec. `--e2e` runs the chosen specs after the unit tests.

const EVERYTHING = ["deno.json", "deno.lock", "playwright.config.ts"];
const SPEC = /^tests\/e2e\/[^/]+\.spec\.ts$/;
/** A change here reaches a spec through no import, so it needs a rule. */
const BROWSER = [
  "src/client/",
  "src/shared/",
  "src/server/",
  "public/",
  "main.ts",
  "tests/e2e/",
];

export interface Rule {
  when: string[];
  specs: string[];
}

/** The specs a diff affects, or "all" when a changed file has no rule. */
export function selectSpecs(
  changed: string[],
  rules: Rule[],
): string[] | "all" {
  const specs = new Set<string>();
  for (const file of changed) {
    if (EVERYTHING.includes(file)) return "all";
    if (SPEC.test(file)) {
      specs.add(file);
      continue;
    }
    const ruled = rules.filter((r) => r.when.some((p) => file.startsWith(p)));
    for (const rule of ruled) {
      for (const spec of rule.specs) specs.add(`tests/e2e/${spec}`);
    }
    if (!ruled.length && BROWSER.some((p) => file.startsWith(p))) {
      if (/\.(js|ts|html|css)$/.test(file)) return "all";
    }
  }
  return [...specs].sort();
}

async function output(cmd: string[]) {
  const out = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "null",
  }).output();
  return new TextDecoder().decode(out.stdout);
}

/** Files changed from the merge base with `base` to the working tree. */
async function changedFiles(base: string): Promise<string[]> {
  const mergeBase = (await output(["git", "merge-base", base, "HEAD"])).trim();
  const tracked = await output(["git", "diff", "--name-only", mergeBase]);
  const fresh = await output(["git", "ls-files", "-o", "--exclude-standard"]);
  return [...new Set(`${tracked}\n${fresh}`.split("\n").filter(Boolean))];
}

async function run(args: string[]) {
  const { code } = await new Deno.Command("deno", {
    args,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return code === 0;
}

if (import.meta.main) {
  Deno.chdir(new URL("..", import.meta.url));
  const base = Deno.args.includes("--base")
    ? Deno.args[Deno.args.indexOf("--base") + 1]
    : "main";
  const changed = await changedFiles(base);
  console.log(`${changed.length} files changed against ${base}`);
  let ok = await run([
    "test",
    `--changed=${base}`,
    "--allow-read",
    "--allow-net",
    "--allow-env",
    "tests/lint",
    "tests/shared",
    "tests/client",
    "tests/server",
  ]);
  if (Deno.args.includes("--e2e")) {
    const rules: Rule[] = JSON.parse(
      await Deno.readTextFile("tests/e2e/impact.json"),
    );
    const specs = selectSpecs(changed, rules);
    console.log(`e2e: ${specs === "all" ? "all" : specs.length} specs`);
    if (specs === "all" || specs.length) {
      ok = await run(["task", "e2e", ...(specs === "all" ? [] : specs)]) && ok;
    }
  }
  if (!ok) Deno.exit(1);
}
