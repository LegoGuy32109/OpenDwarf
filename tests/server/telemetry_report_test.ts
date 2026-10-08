import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { growth, parseLog, sessionReport } from "../../scripts/telemetry.ts";

const line = (ts: string, body: Record<string, unknown>) =>
  JSON.stringify({
    timestamp: ts,
    body: JSON.stringify({
      event: "open-dwarf-client",
      session: "session-a",
      participant: "self",
      role: "host",
      test: false,
      route: "none",
      status: "hosting",
      players: 2,
      frameMeanMs: 16.7,
      frameMaxMs: 20,
      rttMs: null,
      bytesSent: 0,
      queuedBytes: 0,
      ...body,
    }) + "\n",
  });

Deno.test("the log parser keeps telemetry lines only, oldest first", () => {
  const text = [
    line("2026-10-08T22:00:10Z", { kind: "summary" }),
    JSON.stringify({ timestamp: "2026-10-08T22:00:05Z", body: "Listening on" }),
    "not json",
    line("2026-10-08T22:00:00Z", { kind: "connection" }),
    line("2026-10-08T22:00:00Z", { kind: "connection" }),
  ].join("\n");
  const events = parseLog(text);
  assertEquals(events.map((e) => e.kind), ["connection", "summary"]);
});

Deno.test("a counter's growth survives a page reload", () => {
  assertEquals(growth([3, 5, 9]), 6);
  // Reloaded after 9: the new page counts from zero.
  assertEquals(growth([3, 9, 2, 4]), 6 + 2 + 2);
  assertEquals(growth([7]), 7);
  assertEquals(growth([]), 0);
});

Deno.test("a session report names players, frames, network and spikes", () => {
  const events = parseLog([
    line("2026-10-08T22:00:00Z", {
      kind: "summary",
      commit: "d95d07ad743216bf37ff1ad7e3032aa1aeff1588",
      bytesSent: 0,
      metrics: { frameP95Ms: 18, spikes33: 1, longTasks: 0, renderMs: 3 },
    }),
    line("2026-10-08T22:01:00Z", {
      kind: "summary",
      players: 6,
      bytesSent: 61440,
      queuedBytes: 900,
      metrics: {
        frameP95Ms: 45,
        spikes33: 9,
        longTasks: 2,
        longestTaskMs: 130,
        renderMs: 4,
      },
    }),
    line("2026-10-08T22:01:00Z", {
      kind: "summary",
      participant: "peer-0123456789ab-rest",
      role: "guest",
      route: "host/srflx",
      rttMs: 40,
      players: 6,
      metrics: { frameP95Ms: 30 },
    }),
    line("2026-10-08T22:01:30Z", {
      kind: "spike",
      status: "slow-frame",
      detail: "render 300 ms",
      metrics: { frameMs: 300 },
    }),
  ].join("\n"));
  const report = sessionReport(events);
  assertStringIncludes(report, "players (NPC included) up to 6");
  assertStringIncludes(report, "commit d95d07a");
  assertStringIncludes(report, "guest peer-01234567");
  assertStringIncludes(report, "host/srflx");
  assertStringIncludes(report, "host upload KiB/s p50 1.0");
  assertStringIncludes(report, "queued max 900 B");
  assertStringIncludes(report, "spike slow-frame  render 300 ms");
  assert(/22:01\s+6\s+45\.0\s+host:self/.test(report), report);
});
