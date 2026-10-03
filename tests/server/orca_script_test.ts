import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fillBrief, parseFlags } from "../../scripts/orca.ts";

Deno.test("orca flags are --name value pairs", () => {
  assertEquals(parseFlags(["--issue", "60", "--slug", "webgl-ui"]), {
    issue: "60",
    slug: "webgl-ui",
  });
  assertThrows(() => parseFlags(["--issue"]));
  assertThrows(() => parseFlags(["60"]));
});

Deno.test("the worker brief names the branch, base, port, and notes", async () => {
  const template = await Deno.readTextFile(
    new URL("../../docs/orca/worker-brief.md", import.meta.url),
  );
  const brief = fillBrief(template, {
    issue: 61,
    slug: "place-stone",
    base: "client-first-deno",
    port: 8161,
    notes: "Read mining.js first.",
  });
  assertStringIncludes(brief, "`t61-place-stone`");
  assertStringIncludes(brief, "origin/client-first-deno");
  assertStringIncludes(brief, "PORT=8161");
  assertStringIncludes(brief, "NOTES:\nRead mining.js first.");
  assertEquals(/\{(issue|slug|branch|base|port|notes)\}/.test(brief), false);
});
