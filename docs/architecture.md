# Architecture

Open Dwarf is composed of six layers. Each layer has one responsibility and
a small, typed boundary to the one above it.

```
┌──────────────────────────────────────────────────────────────────┐
│ 6. Examples & Tools         examples/mods, examples/bots, scripts/│
├──────────────────────────────────────────────────────────────────┤
│ 5. Playwright Debugger      packages/debugger                     │
├──────────────────────────────────────────────────────────────────┤
│ 4. Public SDK               packages/sdk  (@opendwarf/sdk)        │
├──────────────────────────────────────────────────────────────────┤
│ 3. Mod Runtime              packages/server/mod-runtime           │
├──────────────────────────────────────────────────────────────────┤
│ 2. Multiplayer Server       packages/server  + WebRTC (domain/)   │
├──────────────────────────────────────────────────────────────────┤
│ 1. Game Engine              game_library  (Rust + Bevy → WASM)    │
└──────────────────────────────────────────────────────────────────┘
```

## 1. Game Engine — `game_library/`

The simulation runs in a Bevy ECS world compiled to WebAssembly. The engine
is intentionally agnostic of any UI:

- Authoritative tile/entity state
- Tick loop and system scheduling
- Deterministic given the same seed and input log
- Exposes a small FFI surface consumed by the mod runtime

Languages: Rust. Build: `deno task web-release` (wraps `wasm-bindgen`).

The engine **does not** know about mods, players-as-people, or transports.
It owns the world and accepts inputs.

## 2. Multiplayer Server — Deno + Fresh + WebRTC

The Fresh app serves the client and brokers peer connections.
`domain/webrtc.ts` handles SDP exchange and compressed peer payloads. Once
peers are connected they exchange game messages directly over data channels;
the server is not in the hot path.

- Routes: `routes/` (Fresh)
- Islands (interactive client components): `islands/`
- WebRTC plumbing: `domain/webrtc.ts`
- WebGL harness used by both the game and tests: `lib/webgl-*.ts`

## 3. Mod Runtime — `packages/server/mod-runtime`

The runtime is the only thing that talks to the engine on a mod's behalf.
Responsibilities:

- Discover mods in `mods/`
- Validate manifests and resolve dependency order
- Build a fresh `GameContext` per hook invocation
- Translate context calls into ECS operations
- Sandbox errors so a single mod cannot crash the server

The runtime is the boundary between "third-party TypeScript" and "trusted
engine internals". It is intentionally small — most of the public surface
lives in the SDK.

## 4. Public SDKs — TypeScript and Rust

Two SDKs target the same `Mod` shape inside the runtime.

### `packages/sdk` — TypeScript (`@opendwarf/sdk`)

- `createMod()` — declarative mod factory
- Types: `GameContext`, `Player`, `GameState`, `GameAction`, `GameEvent`,
  `ModManifest`
- Type guards and small helpers (`isPlayer`, `tilesAround`, …)

Pure types and thin helpers. No runtime dependency on the engine; the
runtime satisfies the shape. Mod authors typecheck without booting the
engine.

### `game_library/crates/opendwarf-sdk` — Rust → wasm

- The `Mod` trait with the same five hooks (`on_player_join`, `on_tick`, …)
- Serde-derived types matching the TS SDK one-to-one
- `export_mod!` macro that emits the wasm export entry points
- `GameContext` with `broadcast`, `log_*`, `players()`, `world()`, `now()`

The crate compiles to `wasm32-unknown-unknown`. The resulting `.wasm` is
loaded at runtime by [the wasm host](#wasm-host), which adapts it to the
same `Mod` object the TS path produces. The runtime never learns about
wasm; it sees uniform `Mod` values.

Versioning: both SDKs follow semver. The ABI between the wasm guest and
the host has its own `_opendwarf_abi_version` constant the host validates
at load time.

## Wasm host {#wasm-host}

`packages/server/wasm-host.ts` is the bridge that turns a `.wasm` file into
a `Mod` object. It:

1. Reads the `.wasm` and instantiates it with `WebAssembly.instantiate`,
   providing the `env.__host_*` imports the SDK declares.
2. Validates the guest's `_opendwarf_abi_version` matches the host.
3. Calls `_opendwarf_manifest` to get the mod's name and version.
4. Builds a `Mod` object whose hooks call `_opendwarf_on_*` exports.

The runtime sees a normal `Mod`. Dependency sorting, error sandboxing,
hook order — all uniform across TS and Rust mods.

### ABI v1

Guest **exports** (called by host):

```
_opendwarf_abi_version()                 -> u32
_opendwarf_manifest()                    -> u64    // (ptr<<32)|len
_opendwarf_on_player_join(ptr, len)
_opendwarf_on_player_leave(ptr, len)
_opendwarf_on_tick()
_opendwarf_on_message(ptr, len)
_opendwarf_on_action(ptr, len)
_opendwarf_alloc(size)                   -> ptr
_opendwarf_free(ptr, size)
```

Guest **imports** (provided by host):

```
__host_broadcast(ptr, len)
__host_log(level, ptr, len)
__host_players_list()                    -> u64    // packed (ptr,len)
__host_state_get()                       -> u64
__host_spawn(ptr, len)                   -> u64
__host_now()                             -> u64
```

Wire format: JSON in v1. Both sides have it free, it's debuggable, it's
swappable for MessagePack/bincode behind a feature flag once `onTick`
overhead matters.

## 5. Playwright Debugger — `packages/debugger`

The debugger is a thin developer-facing wrapper over Playwright that
understands Open Dwarf's state model. It exposes:

- `createGameDebugger()` — top-level entry
- `connectPlayer()` — one isolated browser context per player
- State-based waits, snapshots, screenshots
- Recording and replay of interaction traces
- Reliability helpers (`safeAction`, `retryUntil`, …)

The debugger talks to the running game through the same WebSocket/REST
introspection channel the dev tools use — it does not call into the engine
directly.

## 6. Examples & Tools — `examples/`, `scripts/`

Everything in `examples/` is a runnable demonstration of the SDK or
debugger. `scripts/` contains internal automation (asset pipelines, WASM
build, font generation) — these are not part of the public surface.

## Cross-cutting concerns

### Determinism

The engine is deterministic given (seed, ordered input log). The debugger
relies on this for replay. Mods must not introduce nondeterminism (no
`Math.random()` in `onTick` — use `ctx.rng` instead).

### Transport

All multiplayer traffic flows over WebRTC data channels after an initial
SDP exchange. The server is a connection broker, not a relay.

### Trust boundary

Mods are untrusted TypeScript loaded into the server. They are sandboxed by
the runtime: hooks run in a wrapper that catches throws, enforces a hook
budget per tick, and exposes only the `GameContext` API. Future work: move
mods to isolated workers.

## Repository layout

```
packages/
  sdk/                       Public TypeScript SDK (@opendwarf/sdk)
  server/                    Mod runtime + loaders + wasm host
    mod-runtime.ts             dispatcher, error sandbox, dep sort
    mod-loader.ts              discovers .ts and .wasm mods
    wasm-host.ts               adapts .wasm → Mod
    runtime-singleton.ts       process-wide runtime for the Fresh app
  client/                    Game client glue (Fresh app at repo root for now)
  debugger/                  Playwright-powered debugger
examples/
  mods/                      Sample mods (TS + wasm side by side)
  bots/                      Sample automation bots
  debugging/                 Sample Playwright debug flows
docs/                        This documentation
game_library/                Engine + Rust SDK
  src/                         existing Bevy engine
  crates/
    opendwarf-sdk/             Rust SDK (compiles to wasm)
    opendwarf-welcome/         Example Rust mod
routes/                      Fresh routes (server-rendered + APIs)
islands/                     Preact islands (interactive client)
domain/                      Server-side domain logic (WebRTC, Result)
lib/                         Shared TypeScript libraries
tests/                       Playwright + unit tests
scripts/                     Internal build and tooling
static/                      Built WASM artifacts and public assets
```

## Why a layered design

Each layer can be replaced independently:

- Swap WebRTC for WebTransport: only layer 2 changes.
- Replace Bevy with a different engine: only layer 1 changes, provided it
  satisfies the runtime's FFI.
- A mod author touches layers 4 and 6 only.
- A debugger author touches layer 5 only.

This is the property that makes Open Dwarf usable as a *platform* rather
than a single-purpose game.
