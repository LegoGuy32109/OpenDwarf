# Caveats

Honest gaps in the current implementation. Not linked from the navigation
on purpose — this is engineering notes, not a feature page. Update as
items are resolved.

## Wasm ABI

- **JSON-only wire format.** Fine for v1, debuggable, both sides have it
  free. Swap to MessagePack or bincode behind a feature flag before
  `on_tick` becomes a hot path. The hooks already accept this via
  host-side serde — the change is local to `wasm-host.ts` and the SDK's
  `__private` helpers.
- **No sandboxing limits.** `WebAssembly.instantiate` gives a memory
  sandbox by default, but a runaway `on_tick` can wedge the runtime
  (infinite loop, unbounded allocation). Adding wasmtime-style fuel/epoch
  interruption would mean switching off the browser's `WebAssembly` API
  for a Rust-side wasm runtime. Worth it eventually; not v1.
- **No async hooks from wasm.** Guests are synchronous unless we adopt
  the component model or wasi-preview2. The current tick model is sync
  anyway, so the constraint is real but not painful.
- **Floating-point determinism across engines.** If we ever want
  bit-identical replay between TS and Rust mods, we need to pin wasm
  engine behavior. Punt to v2.

## Rust SDK surface

The Rust `GameContext` is intentionally narrower than the TS one. Missing:

- `state.get()` / `state.update()` / `state.subscribe()`
- `ctx.rng` (deterministic seeded RNG)
- `players.get(id)` / `players.kick(id)` / `players.count()`
- `world.despawn(id)` / `world.tiles.at(x, y)`
- `now()` returns `u64` ms only; no monotonic-since-start helper

Adding any of these is mechanical: one host import, one SDK method, one
host adapter. Scope was limited to what the welcome example exercises.

## Engine integration

- **`window.__opendwarf.snapshot()` is a shim, not the engine.** It
  reports the local player from `?playerName=` and ticks at 10 Hz via
  `setInterval`. The Bevy/WASM engine doesn't yet plug into
  `setStateProvider(fn)` — wiring that is the next slice if real engine
  state is required.
- **`__host_state_get` returns the runtime's in-memory state, not the
  ECS world.** This is correct for the mod runtime (mods talk to the
  runtime, runtime talks to the engine), but `state.get()` currently
  has no entities/tiles/weather data of any substance.
- **No bridge from engine ticks to runtime ticks.** `runtime.tick()` is
  driven by example scripts. In production, the Bevy schedule needs to
  call into the runtime once per simulation tick.

## Mod runtime

- **Hook error policy is per-mod, not per-hook.** A mod that throws once
  is disabled for the rest of the session. Some authors might prefer
  per-hook degradation (disable just `onTick`, leave `onPlayerJoin`
  running). Easy change if anyone asks.
- **Dependency resolution is name-only.** Version constraints in
  `dependencies: ["weather-mod@^1.0.0"]` are parsed but not enforced.
  Add semver checking when there's a second mod that needs it.
- **No worker isolation.** All mods run in the server process. A native
  mod can starve others via CPU. The wasm path can't escape its memory
  sandbox but can still hog the event loop. Move to workers when there's
  a multi-mod load case.

## Debugger

- **Reliability helpers validate state changes by tick advancement.**
  `safeAction` waits for `state.tick !== before.tick`, which is a proxy
  for "the simulation advanced," not "the action specifically took
  effect." Replace with action-receipt acks once the engine emits them.
- **Replay matches players by id, which is derived from name.** Two
  Alices in one session get distinct ids (`player_Alice`,
  `player_Alice_2`) — replay against a fresh session works only when
  the same names connect in the same order.
- **`captureSnapshot()` falls back to `{ tick: 0, players: [], ... }`
  when the shim isn't present.** This is correct for the contract but
  silent — there's no warning in the debugger output when the fallback
  is in use. Add a one-time warning.

## Loader

- **No hot-reload.** Loaded mods are pinned for the process lifetime.
  Restart the dev server to pick up changes. File-watching the mods
  directory and re-instantiating wasm/re-importing TS would be a
  meaningful UX improvement.
- **`OPENDWARF_MODS_DIR` default is `./examples/mods/`.** To use the
  Rust mod live with `deno task dev`, copy the built `.wasm` into that
  directory and restart. There's no convention yet for where production
  mods live.

## Docs

- **API reference for the Rust SDK is implicit.** `docs/api-reference.md`
  only lists TS types. Rustdoc on `opendwarf-sdk` is the source of truth
  for the Rust side until that gap closes.
- **No tutorial that builds a non-trivial mod.** The welcome example
  is intentionally minimal. A "build a trader mod with state and
  dependencies" walkthrough would be high signal.
