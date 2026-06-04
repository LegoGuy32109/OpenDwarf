/**
 * examples/debugging/replay-analyzer — record a player's interactions,
 * persist the trace, then replay it against a fresh session.
 *
 * Prereq: dev server running (`deno task dev`).
 *
 * Run:
 *   $ deno run -A examples/debugging/replay-analyzer.ts
 */

import { createGameDebugger } from "@opendwarf/debugger";

await Deno.mkdir("exports/traces", { recursive: true });
const TRACE_PATH = "exports/traces/dig-tunnel.json";

// ---- record ----
{
  const debug = await createGameDebugger({ headless: true });
  try {
    const alice = await debug.connectPlayer("Alice");
    const rec = debug.startRecording();

    await alice.performAction("move", { x: 1, y: 1 });
    await alice.performAction("dig", { x: 1, y: 2 });
    await alice.performAction("dig", { x: 1, y: 3 });

    const trace = rec.stop();
    await trace.save(TRACE_PATH);
    console.log(`recorded ${trace.steps.length} steps → ${TRACE_PATH}`);
  } finally {
    await debug.close();
  }
}

// ---- replay ----
{
  const debug = await createGameDebugger({ headless: true });
  try {
    // The replay matches by player name → id. Reconnect Alice so the
    // recorded ids resolve. (Real replays would map by stable name.)
    await debug.connectPlayer("Alice");
    const trace = await debug.loadTrace(TRACE_PATH);

    console.log(`replaying ${trace.steps.length} steps at 2x speed…`);
    // Note: this demo records and replays in separate debugger sessions, so
    // the ids won't match — replay() will throw. The point is the API
    // contract; once the shim assigns stable ids per player name, this
    // becomes a real cross-session replay.
    try {
      await debug.replay(trace, { speed: 2.0 });
    } catch (e) {
      console.log("(expected) replay id mismatch:", String(e));
    }
  } finally {
    await debug.close();
  }
}
