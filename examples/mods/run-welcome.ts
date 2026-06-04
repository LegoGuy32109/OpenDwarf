/**
 * examples/mods/run-welcome — drive the `welcome` mod with the in-memory
 * mod runtime. Demonstrates that a third-party mod, the SDK, and the
 * runtime all compose without touching the engine.
 *
 * Run:
 *   $ deno run -A examples/mods/run-welcome.ts
 */

import { createModRuntime } from "../../packages/server/mod-runtime.ts";
import { PlayerId } from "@opendwarf/sdk";
import welcome from "./welcome/mod.ts";

const runtime = createModRuntime();
const reg = runtime.register(welcome);
if (!reg.ok) {
  console.error("failed to register welcome:", reg.reason);
  Deno.exit(1);
}

await runtime.start();

await runtime.playerJoin({
  id: PlayerId("p_alice"),
  name: "Alice",
  joinedAt: Date.now(),
  position: { x: 0, y: 0 },
  stats: { hp: 100, hunger: 95, thirst: 20, energy: 80 },
  inventory: new Map(),
});

// Drive a few ticks. `onTick` only runs work every 100 ticks, so push past.
for (let i = 0; i < 101; i++) await runtime.tick();

await runtime.message({ text: "/hello", from: PlayerId("p_alice") });

await runtime.playerLeave(PlayerId("p_alice"));

console.log("loaded:", runtime.loadedMods());
console.log("final tick:", runtime.state().tick);

await runtime.stop();
