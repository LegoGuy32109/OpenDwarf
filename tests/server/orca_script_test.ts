import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  actionableWorkerReports,
  fillBrief,
  parseFlags,
  workerCheckArguments,
  workerWorktreeId,
} from "../../scripts/orca.ts";

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
    base: "main",
    port: 8161,
    notes: "Read mining.js first.",
  });
  assertStringIncludes(brief, "`t61-place-stone`");
  assertStringIncludes(brief, "origin/main");
  assertStringIncludes(brief, "PORT=8161");
  assertStringIncludes(brief, "NOTES:\nRead mining.js first.");
  assertEquals(/\{(issue|slug|branch|base|port|notes)\}/.test(brief), false);
});

Deno.test("worker polling acknowledges prior delivery and bounds the remaining wait", () => {
  assertEquals(workerCheckArguments("run", undefined, 5000), [
    "orchestration",
    "check",
    "--run",
    "run",
    "--wait",
    "--timeout-ms",
    "5000",
  ]);
  assertEquals(workerCheckArguments("run", "delivery", 0), [
    "orchestration",
    "check",
    "--run",
    "run",
    "--ack",
    "delivery",
    "--wait",
    "--timeout-ms",
    "1000",
  ]);
  assertEquals(workerWorktreeId({}), "");
  assertEquals(
    workerWorktreeId({ resource: { worktreeId: "repo/branch" } }),
    "repo/branch",
  );
});

Deno.test("worker reports retain questions, escalations and completion but omit heartbeats", () => {
  assertEquals(actionableWorkerReports({}), []);
  const report = { type: "worker_done", body: "complete" };
  assertEquals(
    actionableWorkerReports({ messages: [{ type: "heartbeat" }, report] }),
    [report],
  );
});
