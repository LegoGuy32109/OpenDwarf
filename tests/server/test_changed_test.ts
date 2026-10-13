import { assert, assertEquals } from "@std/assert";
import { type Rule, selectSpecs } from "../../scripts/test-changed.ts";

const rules: Rule[] = [
  { when: ["src/shared/reach.js"], specs: ["reach.spec.ts"] },
];
Deno.test("a changed spec and a ruled file choose their specs", () => {
  assertEquals(selectSpecs(["src/shared/reach.js"], rules), [
    "tests/e2e/reach.spec.ts",
  ]);
  assertEquals(selectSpecs(["tests/e2e/mining.spec.ts"], rules), [
    "tests/e2e/mining.spec.ts",
  ]);
});

Deno.test("a browser file with no rule runs every spec", () => {
  assertEquals(selectSpecs(["src/shared/view.js"], rules), "all");
  assertEquals(selectSpecs(["src/server/store.ts"], rules), "all");
  assertEquals(selectSpecs(["tests/e2e/ui.ts"], rules), "all");
});

Deno.test("docs and unit tests run no spec, a config runs all", () => {
  assertEquals(
    selectSpecs(
      ["docs/a.md", "tests/shared/x_test.ts", "src/client/notes.md"],
      rules,
    ),
    [],
  );
  assertEquals(selectSpecs(["deno.json"], rules), "all");
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
