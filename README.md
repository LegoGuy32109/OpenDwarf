<h1 align="center">
  <img
    src="./static/assets/sprites/Dwarf_16x16.png"
    alt="Open Dwarf sprite"
    width="32"
    height="32"
  />
  Open Dwarf
</h1>

<p align="center">
  A multiplayer fortress game for players and a typed modding/debugging stack
  for developers.
</p>

<p align="center">
  <img
    src="./docs/images/game_example"
    alt="Open Dwarf game example"
    width="736"
  />
</p>

<p align="center">
  Play the fortress, shape the simulation, and debug the same world from both
  sides of the screen.
</p>

Open Dwarf is a Dwarf Fortress–inspired browser game built for the people who
want to jump into a living fortress and the people who want to shape it.
It runs on a Bevy/WebAssembly engine, a Deno + Fresh web app, and WebRTC for
peer-to-peer multiplayer. Developers can build custom game modes, automation
bots, and debugging workflows against a stable public API. The project ships a
browser automation layer for inspecting multiplayer sessions, replaying
interactions, and validating game behavior across multiple clients.

## Why players and developers use it

Most game projects treat browser automation as throwaway test infrastructure.
Open Dwarf treats it as part of the experience: the same primitives a mod
author uses to extend the game are the ones a developer uses to drive it from
Playwright, simulate players, and assert on game state. The goal is a
reproducible, typed, developer-first interface to a complex multiplayer
simulation without making the player-facing side feel bolted on.

## Quickstart

```bash
# 1. Install Deno (https://docs.deno.com/runtime/getting_started/installation)
# 2. Build the WebAssembly engine
deno task web-release

# 3. Run the dev server
deno task dev
# → http://localhost:8000

# 4. (Optional) Run the Playwright debug examples
deno task test
```

## Build Mods With The SDK — TypeScript or Rust

Open Dwarf ships **two author-facing SDKs**, both targeting the same
sandboxed runtime on the server. Pick the language that fits the job:

- **TypeScript** (`@opendwarf/sdk`) — fast iteration, no build step,
  hot-reload from source. Best for gameplay scripting, UI logic, glue.
- **Rust** (`opendwarf-sdk`) — compiled to WebAssembly, sandboxed by the
  same wasm-host, with the speed, safety, and type system of Rust. Best
  for perf-sensitive or type-strict mods.

Both expose the same hook names (`on_player_join`, `on_tick`, …) and the
same value types. A mod in either language ends up as the same `Mod`
object inside the runtime.

### TypeScript

```ts
import { createMod } from "@opendwarf/sdk";

export default createMod({
  name: "welcome-mod",
  version: "1.0.0",

  onPlayerJoin(ctx, player) {
    ctx.broadcast(`${player.name} entered the fortress.`);
  },

  onTick(ctx) {
    for (const dwarf of ctx.players.list()) {
      if (dwarf.stats.hunger > 80) {
        ctx.world.spawn("food", { near: dwarf.id });
      }
    }
  },
});
```

### Rust

```rust
use opendwarf_sdk::{export_mod, GameContext, Mod, ModManifest, Player};

#[derive(Default)]
pub struct Welcome;

impl Mod for Welcome {
    fn manifest(&self) -> ModManifest {
        ModManifest::new("welcome-mod", "1.0.0")
    }

    fn on_player_join(&self, ctx: &mut GameContext, p: &Player) {
        ctx.broadcast(&format!("{} entered the fortress.", p.name));
    }

    fn on_tick(&self, ctx: &mut GameContext) {
        for player in ctx.players().list() {
            if player.stats.hunger > 80.0 {
                ctx.world().spawn("food").near(player.id).fire();
            }
        }
    }
}

export_mod!(Welcome);
```

Build:

```bash
cd game_library/crates/opendwarf-welcome
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/opendwarf_welcome.wasm \
   ../../../examples/mods/
```

The loader discovers `.wasm` and `mod.ts` side by side — drop the binary
next to any TypeScript mods.

## Debug Multiplayer Sessions

```ts
import { createGameDebugger } from "@opendwarf/debugger";

const debug = await createGameDebugger({
  baseUrl: "http://localhost:8000",
});

const alice = await debug.connectPlayer("Alice");
const bob = await debug.connectPlayer("Bob");

await alice.performAction("move", { x: 10, y: 5 });
await debug.waitForState((state) => state.players.length === 2);

const snapshot = await debug.captureSnapshot();
await debug.close();
```

## Write A Mod

A mod is a TypeScript module that exports a `createMod()` result. Drop it in
`mods/` and Open Dwarf loads it on server startup:

```ts
// mods/greeter/mod.ts
import { createMod } from "@opendwarf/sdk";

export default createMod({
  name: "greeter",
  onMessage(ctx, msg) {
    if (msg.text === "/hello") ctx.broadcast("Hello!");
  },
});
```

See [examples/mods](./examples/mods) for runnable mods.

## How It Fits Together

```
┌────────────────────────────────────────────────────────────────────┐
│  Playwright Debugger  (packages/debugger)                          │
│  connectPlayer · waitForState · captureSnapshot · replay           │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ drives browser clients
┌──────────────────────────────▼─────────────────────────────────────┐
│  Game Client  (Fresh + Preact islands + WebGL canvas)              │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ WebRTC data channels
┌──────────────────────────────▼─────────────────────────────────────┐
│  Mod Runtime  (packages/server)                                    │
│     ▲                                ▲                             │
│     │ TS mods                        │ Wasm mods                   │
│     │                                │                             │
│  @opendwarf/sdk                opendwarf-sdk  (Rust → wasm32)      │
│  (loaded directly)             (loaded via wasm-host.ts)           │
│                                                                    │
│            │ shared FFI to engine                                  │
│            ▼                                                       │
│  Game Engine  (game_library, Rust + Bevy → WASM)                   │
└────────────────────────────────────────────────────────────────────┘
```

See [docs/architecture.md](./docs/architecture.md) for the full breakdown.

## Documentation

- [Getting Started](./docs/getting-started.md) — install, run, write your first mod
- [Modding API](./docs/modding-api.md) — hooks, context, world primitives
- [Debugging with Playwright](./docs/debugging-with-playwright.md) — automation layer
- [Architecture](./docs/architecture.md) — how the layers fit together
- [API Reference](./docs/api-reference.md) — every exported type and function

## Examples

- [`examples/mods/welcome`](./examples/mods/welcome) — TypeScript mod, react to player join/leave
- [`game_library/crates/opendwarf-welcome`](./game_library/crates/opendwarf-welcome) — same mod, written in Rust → wasm
- [`examples/mods/run-welcome.ts`](./examples/mods/run-welcome.ts) — drive the TS mod through the runtime
- [`examples/mods/run-welcome-rs.ts`](./examples/mods/run-welcome-rs.ts) — drive the Rust wasm mod through the same runtime
- [`examples/debugging/multiplayer-session`](./examples/debugging/multiplayer-session) — 2-client Playwright flow
- [`examples/debugging/replay-analyzer`](./examples/debugging/replay-analyzer) — record and replay interactions

## Contributing

Contributions are welcome. Please:

1. Open an issue describing the change before large refactors.
2. Run `deno task check` and `deno task test` locally.
3. Keep public SDK changes backward-compatible or document the migration.

The project uses Deno workspaces. SDK and debugger packages live under
`packages/` and are published independently.

## License

MIT
