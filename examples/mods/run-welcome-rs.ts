/**
 * examples/mods/run-welcome-rs — load the Rust-authored welcome mod
 * (compiled to wasm) into the same ModRuntime used by TS mods.
 *
 * Build the wasm first:
 *   cd game_library/crates/opendwarf-welcome
 *   cargo build --release --target wasm32-unknown-unknown
 *
 * Run:
 *   deno run -A examples/mods/run-welcome-rs.ts
 */

import { createModRuntime } from "../../packages/server/mod-runtime.ts";
import { loadWasmMod } from "../../packages/server/wasm-host.ts";
import { PlayerId } from "@opendwarf/sdk";

const WASM_PATH =
  "game_library/crates/opendwarf-welcome/target/wasm32-unknown-unknown/release/opendwarf_welcome.wasm";

const wasmMod = await loadWasmMod(WASM_PATH);
console.log("loaded wasm mod:", wasmMod.manifest);

const runtime = createModRuntime();
const reg = runtime.register(wasmMod);
if (!reg.ok) {
  console.error("register failed:", reg.reason);
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

for (let i = 0; i < 5; i++) await runtime.tick();

await runtime.message({ text: "/hello", from: PlayerId("p_alice") });

await runtime.playerLeave(PlayerId("p_alice"));

console.log("final loaded:", runtime.loadedMods());
