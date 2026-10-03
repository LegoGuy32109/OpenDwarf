import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  type DeployCommands,
  DeployRefused,
  type DeployResult,
  isExcluded,
  parseDeployOutput,
  runShellDeploy,
} from "../../scripts/shell-deploy.ts";
import { createMemoryStore } from "../../src/server/store.ts";

const COMMIT = "6f5cedd0123456789abcdef0123456789abcdef0";

/** Stubbed commands that record what ran. Override any field per test. */
function stubs(over: Partial<DeployCommands> = {}) {
  const store = createMemoryStore({ now: () => 1000 });
  const calls: string[] = [];
  const commands: DeployCommands = {
    dirtyFiles: () => Promise.resolve([]),
    headCommit: () => Promise.resolve(COMMIT),
    pendingProductionMigrations: () => Promise.resolve([]),
    trackedFiles: () =>
      Promise.resolve(["main.ts", "docs/a.md", "src/server/app.ts"]),
    excludes: () => Promise.resolve(["docs", ".env.*"]),
    deploy(args) {
      calls.push(`deploy ${args.join(" ")}`);
      const result: DeployResult = {
        success: true,
        code: 0,
        stdout: 'log line\n{"revisionId":"rev-42","productionUrl":"https://x"}',
      };
      return Promise.resolve(result);
    },
    store: () => store,
    ...over,
  };
  return { commands, store, calls };
}

const real = { dryRun: false, note: "first", hasToken: true };

Deno.test("a clean tree with no pending migration deploys and records", async () => {
  const { commands, store, calls } = stubs();
  const lines = await runShellDeploy(commands, real);
  assertEquals(calls.length, 1);
  assertStringIncludes(calls[0], "--prod");
  assertStringIncludes(calls[0], "--app opendwarf");
  assertStringIncludes(lines.join("\n"), "rev-42");
  assertEquals(await store.listShellDeploys(), [{
    commit: COMMIT,
    denoRevision: "rev-42",
    at: 1000,
    note: "first",
  }]);
});

Deno.test("a dirty tree is refused before anything runs", async () => {
  const { commands, store, calls } = stubs({
    dirtyFiles: () => Promise.resolve([" M main.ts"]),
  });
  const error = await assertRejects(
    () => runShellDeploy(commands, real),
    DeployRefused,
  );
  assertStringIncludes(error.message, "dirty");
  assertEquals(calls, []);
  assertEquals(await store.listShellDeploys(), []);
});

Deno.test("a pending production migration is refused and named", async () => {
  const { commands, store, calls } = stubs({
    pendingProductionMigrations: () => Promise.resolve(["002_next.sql"]),
  });
  const error = await assertRejects(
    () => runShellDeploy(commands, real),
    DeployRefused,
  );
  assertStringIncludes(error.message, "002_next.sql");
  assertStringIncludes(error.message, "db:migrate:prod");
  assertEquals(calls, []);
  assertEquals(await store.listShellDeploys(), []);
});

Deno.test("a real deploy without a token is refused; a dry run needs none", async () => {
  const { commands, calls } = stubs();
  await assertRejects(
    () => runShellDeploy(commands, { ...real, hasToken: false }),
    DeployRefused,
    "DENO_DEPLOY_TOKEN",
  );
  await runShellDeploy(commands, { ...real, dryRun: true, hasToken: false });
  assertEquals(calls, []);
});

Deno.test("a failed deploy records nothing", async () => {
  const { commands, store } = stubs({
    deploy: () => Promise.resolve({ success: false, code: 1, stdout: "boom" }),
  });
  await assertRejects(() => runShellDeploy(commands, real), Error, "exited");
  assertEquals(await store.listShellDeploys(), []);
});

Deno.test("a deploy without a revision id records nothing", async () => {
  const { commands, store } = stubs({
    deploy: () =>
      Promise.resolve({ success: true, code: 0, stdout: "not json" }),
  });
  await assertRejects(() => runShellDeploy(commands, real), Error, "revision");
  assertEquals(await store.listShellDeploys(), []);
});

Deno.test("a dry run lists the upload and runs and records nothing", async () => {
  const { commands, store, calls } = stubs();
  const text = (await runShellDeploy(commands, { ...real, dryRun: true }))
    .join("\n");
  assertStringIncludes(text, "Dry run");
  assertStringIncludes(text, COMMIT);
  assertStringIncludes(text, "  main.ts");
  assertStringIncludes(text, "  src/server/app.ts");
  assertEquals(text.includes("  docs/a.md"), false);
  assertEquals(calls, []);
  assertEquals(await store.listShellDeploys(), []);
});

Deno.test("a dry run still refuses a dirty tree", async () => {
  const { commands } = stubs({
    dirtyFiles: () => Promise.resolve(["?? x"]),
  });
  await assertRejects(
    () => runShellDeploy(commands, { ...real, dryRun: true }),
    DeployRefused,
  );
});

Deno.test("exclude entries match prefixes and patterns", () => {
  const excludes = ["tests", ".env.*", "./docs/"];
  assertEquals(isExcluded("tests/e2e/a.ts", excludes), true);
  assertEquals(isExcluded(".env.prod", excludes), true);
  assertEquals(isExcluded("docs/a.md", excludes), true);
  assertEquals(isExcluded("testsuite.ts", excludes), false);
  assertEquals(isExcluded("src/a.ts", excludes), false);
});

Deno.test("deploy output parsing reads the last JSON line", () => {
  assertEquals(parseDeployOutput('x\n{"revisionId":"r1"}'), {
    revisionId: "r1",
    productionUrl: undefined,
  });
  assertEquals(parseDeployOutput("nope"), {});
});

Deno.test("a missing .env.prod refuses a deploy and only notes it in a dry run", async () => {
  const { commands } = stubs({
    pendingProductionMigrations: () => Promise.resolve(null),
  });
  await assertRejects(
    () => runShellDeploy(commands, real),
    DeployRefused,
    ".env.prod",
  );
  const text = (await runShellDeploy(commands, { ...real, dryRun: true }))
    .join("\n");
  assertStringIncludes(text, "Migration check skipped");
});
