/**
 * examples/debugging/multiplayer-session — connect two simulated players,
 * wait for a real state condition, and capture a snapshot.
 *
 * Prereq: the dev server is running.
 *   $ deno task dev
 *
 * Run:
 *   $ deno run -A examples/debugging/multiplayer-session.ts
 *
 * Until the client-side `window.__opendwarf` shim is wired, snapshots fall
 * back to a minimal page-level shape — the script still demonstrates the
 * full debugger contract end-to-end.
 */

import { createGameDebugger } from "@opendwarf/debugger";

const debug = await createGameDebugger({
  baseUrl: Deno.env.get("OPENDWARF_URL") ?? "http://localhost:8000",
  headless: Deno.env.get("HEADLESS") !== "false",
});

try {
  console.log("connecting Alice…");
  const alice = await debug.connectPlayer("Alice");

  console.log("connecting Bob…");
  const bob = await debug.connectPlayer("Bob");

  console.log("waiting for both clients to be ready…");
  await debug.waitForState((s) => s.tick >= 0, { timeout: 10_000 });

  console.log("Alice performs a move action");
  await alice.performAction("move", { x: 10, y: 5 });

  const snapshot = await debug.captureSnapshot();
  console.log("snapshot:", JSON.stringify(snapshot, null, 2));

  await debug.screenshot({
    path: "exports/screenshots/multiplayer-session.png",
    from: alice.id,
  });

  console.log("done. bob:", bob.name);
} finally {
  await debug.close();
}
