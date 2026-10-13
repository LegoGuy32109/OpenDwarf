// Runs only the unit tests a diff can affect.
//
//   deno task test:changed [--base main]
//
// `deno test --changed` follows the module graph from each unit test and runs
// the ones that reach a changed file. It cannot see a file a test reads at run
// time (docs, SQL), so `ALWAYS` runs regardless. Browser specs import almost
// nothing from `src/`, so no import graph can choose them; CI shards them.

/** Tests whose inputs are files read at run time, so no import links them to a change. */
const ALWAYS = [
  "tests/lint",
  "tests/server/build_index_test.ts",
  "tests/server/migrations_test.ts",
  "tests/server/orca_script_test.ts",
  "tests/server/shell_deploy_test.ts",
  "tests/server/store_turso_test.ts",
];
const FLAGS = ["--allow-read", "--allow-net", "--allow-env"];

const base = Deno.args.includes("--base")
  ? Deno.args[Deno.args.indexOf("--base") + 1]
  : "main";

async function test(...args: string[]) {
  const { code } = await new Deno.Command("deno", {
    args: ["test", ...FLAGS, ...args],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return code === 0;
}

Deno.chdir(new URL("..", import.meta.url));
const changed = await test(
  `--changed=${base}`,
  "tests/shared",
  "tests/client",
  "tests/server",
);
const always = await test(...ALWAYS);
if (!changed || !always) Deno.exit(1);
