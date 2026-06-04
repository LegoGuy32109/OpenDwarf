# Modding API

The modding API has **two implementations** of the same surface:

- **TypeScript** — `@opendwarf/sdk`. The primary reference; this document
  shows TS signatures.
- **Rust** — `opendwarf-sdk` crate, compiled to `wasm32-unknown-unknown`.
  Mirrors the same types and hook names. See
  [Rust SDK](#rust-sdk-wasm) at the bottom for the Rust analogue.

Pick the language that fits the job. Both produce the same `Mod` object
inside the runtime and dispatch through the same hooks.

## Mental model

A mod is a declarative object passed to `createMod()`. Open Dwarf's mod
runtime loads every mod at server startup, validates its manifest, and
invokes its lifecycle hooks during simulation. Mods never touch the engine
directly — they read and mutate state through the `GameContext` passed to
each hook.

```
   ┌─────────────┐    hook(ctx, …)    ┌──────────────┐
   │  Mod        │ ─────────────────► │ Mod Runtime  │
   │  (your TS)  │ ◄───────────────── │              │
   └─────────────┘   ctx.broadcast,   └──────┬───────┘
                     ctx.world.spawn         │ ECS ops
                                             ▼
                                      ┌──────────────┐
                                      │ Bevy Engine  │
                                      └──────────────┘
```

## `createMod()`

```ts
import { createMod } from "@opendwarf/sdk";

export default createMod({
  name: "trader-mod",
  version: "1.2.0",
  // optional manifest fields
  description: "Adds a wandering trader every full moon.",
  author: "you@example.com",
  dependencies: ["weather-mod@^1.0.0"],

  // lifecycle hooks (all optional)
  onPlayerJoin(ctx, player) { … },
  onPlayerLeave(ctx, player) { … },
  onTick(ctx) { … },
  onMessage(ctx, message) { … },
  onAction(ctx, action) { … },
  onStateChange(ctx, change) { … },
});
```

`createMod()` returns a `Mod` value. The default export of every mod file
**must** be a `Mod`.

## Lifecycle hooks

| Hook              | Called when                                                | Signature                                                |
| ----------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| `onPlayerJoin`    | A player successfully connects.                            | `(ctx: GameContext, player: Player) => void \| Promise`  |
| `onPlayerLeave`   | A player disconnects or is kicked.                         | `(ctx: GameContext, player: Player) => void \| Promise`  |
| `onTick`          | Each simulation tick (default ~10Hz).                      | `(ctx: GameContext) => void \| Promise`                  |
| `onMessage`       | Any player sends a chat message.                           | `(ctx: GameContext, msg: GameMessage) => void \| Promise`|
| `onAction`        | A player submits a `GameAction`.                           | `(ctx: GameContext, action: GameAction) => void \| Promise`|
| `onStateChange`   | The engine emits a state diff (births, deaths, spawns…).   | `(ctx: GameContext, change: StateChange) => void \| Promise`|

Hooks may be async. The runtime awaits each hook before applying the next
state diff, so a slow hook delays the tick — keep them fast.

## `GameContext`

`ctx` is the only handle a hook has to the running game.

### Broadcasting

```ts
ctx.broadcast("Server message visible to all players.");
ctx.broadcast({ kind: "alert", text: "Goblin siege!" });
```

### Players

```ts
ctx.players.list();           // Player[]
ctx.players.get(playerId);    // Player | undefined
ctx.players.count();          // number
ctx.players.kick(playerId);   // void
```

### World

```ts
ctx.world.spawn("dwarf", { name: "Urist", x: 0, y: 0 });
ctx.world.spawn("item", { kind: "ale", near: dwarfId });
ctx.world.despawn(entityId);
ctx.world.tiles.at(x, y);     // Tile | undefined
```

### State

```ts
const state = ctx.state.get();                  // GameState (immutable snapshot)
ctx.state.update((draft) => {                   // immer-style draft
  draft.weather = "raining";
});
ctx.state.subscribe((next, prev) => { … });     // optional inline subscription
```

### Logging

```ts
ctx.log.info("trader spawned");
ctx.log.warn("dependency mod missing");
ctx.log.error(err);
```

Mod logs are namespaced by mod name in the server console and exposed via
the debugger's trace stream.

## Types

The full set of public types is in [API Reference](./api-reference.md). The
ones you'll touch most often:

- `Mod` — what `createMod()` returns
- `ModManifest` — name, version, dependencies
- `GameContext` — passed to every hook
- `Player` — id, name, position, stats
- `GameState` — immutable snapshot of the world
- `GameAction` — a player-submitted action (move, build, attack…)
- `GameEvent` — anything emitted by the engine

## Loading order and dependencies

Mods declare dependencies in their manifest:

```ts
createMod({
  name: "trader-mod",
  dependencies: ["weather-mod@^1.0.0"],
  …
});
```

The runtime topologically sorts mods at startup and refuses to load a mod
whose dependencies are missing or version-incompatible.

## Error handling

If a hook throws, the runtime:

1. Catches the error and logs it with the mod's namespace.
2. Disables that mod's hooks for the remainder of the session.
3. Continues running every other mod and the simulation.

A misbehaving mod cannot crash the server.

## Authoring tips

- Treat `ctx.state.get()` as immutable. Mutate only via `ctx.state.update()`.
- Avoid blocking I/O in `onTick`. Cache aggressively.
- Use `ctx.log` rather than `console.log` so output flows through the
  debugger's trace channel.
- Prefer `ctx.world.spawn()` over reaching into the engine — direct engine
  access is unstable and unsupported.

---

## Rust SDK (wasm)

The Rust SDK is the same API, in idiomatic Rust, compiled to WebAssembly
and loaded by the same wasm host on the server. A `.wasm` mod is
indistinguishable from a TS mod once it's in the runtime.

### Authoring

```rust
use opendwarf_sdk::{export_mod, GameContext, Mod, ModManifest, Player, GameMessage};

#[derive(Default)]
pub struct Welcome;

impl Mod for Welcome {
    fn manifest(&self) -> ModManifest {
        ModManifest::new("welcome", "0.1.0")
            .author("Open Dwarf examples")
    }

    fn on_player_join(&self, ctx: &mut GameContext, p: &Player) {
        ctx.broadcast(&format!("{} entered the fortress.", p.name));
    }

    fn on_tick(&self, ctx: &mut GameContext) {
        for player in ctx.players().list() {
            if player.stats.hunger > 80.0 {
                ctx.world().spawn("item").near(player.id.clone()).fire();
            }
        }
    }

    fn on_message(&self, ctx: &mut GameContext, msg: &GameMessage) {
        if msg.text == "/hello" {
            ctx.broadcast("Hello to you too!");
        }
    }
}

export_mod!(Welcome);
```

### Hook ↔ method mapping

| TypeScript        | Rust                |
| ----------------- | ------------------- |
| `onPlayerJoin`    | `on_player_join`    |
| `onPlayerLeave`   | `on_player_leave`   |
| `onTick`          | `on_tick`           |
| `onMessage`       | `on_message`        |
| `onAction`        | `on_action`         |

Type mapping is one-to-one: `Player`, `GameContext`, `GameAction`,
`GameMessage`, `ModManifest` all exist in both SDKs with the same fields.

### Building

```bash
cd game_library/crates/opendwarf-welcome
cargo build --release --target wasm32-unknown-unknown
```

Output: `target/wasm32-unknown-unknown/release/opendwarf_welcome.wasm`
(roughly 100 KB stripped).

### Loading

Drop the `.wasm` into the mods directory the server scans (default
`./examples/mods/`). The loader picks up `*.wasm` files automatically — no
config change needed:

```
examples/mods/
  welcome/mod.ts            ← TypeScript mod
  opendwarf_welcome.wasm    ← Rust mod (same runtime)
```

### ABI

The wasm guest exports a stable set of `_opendwarf_*` functions and imports
`__host_*` from the runtime. JSON is the wire format in v1; swap to
MessagePack/bincode behind a feature flag once perf matters. See
[architecture.md](./architecture.md#wasm-host) for the full ABI.

### When to use which SDK

| If you're…                          | Use         |
| ----------------------------------- | ----------- |
| Writing gameplay scripts, UI glue   | TypeScript  |
| Iterating quickly without a build   | TypeScript  |
| Adding perf-sensitive simulation    | Rust → wasm |
| Sharing types with the engine crate | Rust → wasm |
| Distributing a closed-source mod    | Rust → wasm |
