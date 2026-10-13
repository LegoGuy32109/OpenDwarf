import { assert, assertEquals } from "@std/assert";
import { type Rule, selectTests } from "../../scripts/test-changed.ts";

const rules: Rule[] = [
  { when: ["src/shared/reach.js"], specs: ["reach.spec.ts"] },
];
const graph: Record<string, string[]> = {
  "src/shared/reach.js": [
    "src/client/cursor.js",
    "tests/shared/reach_test.ts",
    "tests/client/cursor_test.ts",
    "tests/e2e/wire.spec.ts",
  ],
  "src/shared/view.js": ["src/client/network.js", "tests/shared/view_test.ts"],
  "src/server/store.ts": ["tests/server/store_test.ts"],
  "tests/shared/reach_test.ts": [],
};
const dependents = (file: string) => Promise.resolve(graph[file] ?? null);

Deno.test("unit tests are the dependents plus a changed test", async () => {
  const pick = await selectTests(["src/shared/reach.js"], dependents, rules);
  assertEquals(pick.unit, [
    "tests/client/cursor_test.ts",
    "tests/shared/reach_test.ts",
  ]);
  assertEquals(pick.e2e, [
    "tests/e2e/reach.spec.ts",
    "tests/e2e/wire.spec.ts",
  ]);
  assertEquals(pick.reasons, []);
  const own = await selectTests(["tests/shared/reach_test.ts"], dependents, []);
  assertEquals(own.unit, ["tests/shared/reach_test.ts"]);
  assertEquals(own.e2e, []);
});

Deno.test("a browser file with no rule runs every spec", async () => {
  const pick = await selectTests(["src/shared/view.js"], dependents, rules);
  assertEquals(pick.unit, ["tests/shared/view_test.ts"]);
  assertEquals(pick.e2e, "all");
  assert(pick.reasons[0].includes("every spec"));
});

Deno.test("server and doc changes run no browser spec", async () => {
  const pick = await selectTests(
    ["src/server/store.ts", "docs/features/chat.md", "README.md"],
    dependents,
    rules,
  );
  assertEquals(pick.unit, ["tests/server/store_test.ts"]);
  assertEquals(pick.e2e, []);
});

Deno.test("a file the graph does not know, or a config, widens the run", async () => {
  const gone = await selectTests(["src/shared/old.js"], dependents, rules);
  assertEquals(gone.unit, "all");
  const config = await selectTests(["deno.json"], dependents, rules);
  assertEquals([config.unit, config.e2e], ["all", "all"]);
});

Deno.test("every spec in the impact map exists", async () => {
  const map: Rule[] = JSON.parse(
    await Deno.readTextFile("tests/e2e/impact.json"),
  );
  for (const rule of map) {
    for (const spec of rule.specs) {
      await Deno.stat(`tests/e2e/${spec}`);
    }
    for (const prefix of rule.when) {
      const dir = prefix.slice(0, prefix.lastIndexOf("/"));
      const names = [...Deno.readDirSync(dir)].map((e) => `${dir}/${e.name}`);
      assert(
        names.some((n) => n.startsWith(prefix)),
        `no file starts with ${prefix}`,
      );
    }
  }
});
