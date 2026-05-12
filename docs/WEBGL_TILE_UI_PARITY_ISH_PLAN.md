# WebGL Parity-Ish Test Plan

## Summary

Build the next WebGL test as a deterministic JS mini-runtime, not Rust
integration. Keep accepted visual differences for tint and ceiling shadows, but
add the missing gameplay-shaped pieces needed for FogShadow and chat parity:
player entity, fixed-tick input, entity/master modes, LOS-based FOV, FogShadow
overlay, player sprite, slash-command chat, and chat bubbles.

## Key Changes

- Add deterministic fixed-step runtime state:
  - `simTick`, `viewMode: "entity" | "master"`, `uiMode: "world" | "chat"`,
    `viewZ`, camera, player position, held keys, chat buffer, submitted bubbles.
  - Browser handlers only normalize events into a replay/input log; simulation
    consumes that log on fixed ticks.
- Split controls:
  - `ESDF` moves the player in world mode.
  - `IJKL` pans the camera in world mode.
  - `R/V` changes z-level only in world mode.
  - While `uiMode === "chat"`, `R/V/ESDF/IJKL` are text input only and do not
    trigger gameplay.
- Chat behavior:
  - `/` opens chat immediately with `/` already in the buffer.
  - `T` opens empty chat as a secondary/native-compatible shortcut.
  - `Enter` submits; `Escape` cancels; `Backspace` deletes one char;
    `Ctrl+Backspace` or `Shift+Backspace` deletes last word.
  - `/entity` switches to entity mode; `/master` switches to master mode;
    unknown commands silently close with no effect.
  - Non-command submissions render as WebGL chat bubbles above the player
    sprite.
- Entity/FOV/FogShadow:
  - Add a JS player entity at integer tile position with deterministic movement
    on fixed ticks.
  - Draw `Dwarf.png` or the current web-visible dwarf sprite as a pixelated
    WebGL sprite at the player tile.
  - In entity mode, compute deterministic LOS-radius visibility from the player
    using JS terrain solidity; maintain visible and remembered tile sets.
  - Render FogShadow only in entity mode over the world stack and before
    UI/text.
  - In master mode, skip FogShadow and render the broader simulated world view.
- Renderer parity boundaries:
  - Keep existing JS visual deviations for tint and ceiling-shadow behavior.
  - Preserve current floor/edge/ceiling layer ordering, then insert FogShadow
    after ceiling shadows and before UI.
  - Do not add Rust/wasm communication.

## Public/Test Interfaces

- Extend replay events with normalized input:
  - `key_down`, `key_up`, `text`, `fullscreen`, `resize`, and deterministic
    command/checkpoint events.
- Extend harness snapshots to include:
  - `simTick`, `viewMode`, `uiMode`, player tile, camera center, chat buffer,
    submitted bubbles, visible FOV count, remembered FOV count, active keys,
    draw-order labels.
- Add harness helpers only if needed for tests:
  - set player tile, set view mode, replay input log, capture runtime snapshot.

## Test Plan

- Unit tests:
  - Input normalization suppresses gameplay while typing.
  - `/` opens chat with `/`; `T` opens empty chat.
  - `/entity` and `/master` change view mode deterministically.
  - Replayed ESDF movement reaches the same final player tile.
  - Replayed IJKL camera pan reaches the same final camera center.
  - LOS FOV returns stable visible/remembered tile sets for a fixed seed/player
    tile.
  - FogShadow is emitted only in entity mode.
  - Draw order is stable: floor stack, edge shadow, ceiling shadow, FogShadow,
    player/chat/UI as applicable.
- Playwright tests:
  - Move player with ESDF while camera remains independent.
  - Pan camera with IJKL while player remains independent.
  - Open slash chat, type `/master`, submit, assert master mode and no
    FogShadow.
  - Open slash chat, type `/entity`, submit, assert entity mode and FogShadow.
  - Submit normal chat text and assert a bubble appears above the player.
  - While chat is open, type `rvesdfijkl` and assert no movement, no camera pan,
    and no z-level change.
- Validation:
  - Run `deno task check`.
  - Run existing WebGL tests plus the new parity-ish tests.

## Assumptions

- FOV will use deterministic JS line-of-sight radius, not a full Rust port yet.
- `/` plus `T` are both supported; `/` preloads command mode and `T` opens
  normal chat.
- Visual parity is intentionally relaxed for current tint colors and
  ceiling-shadow behavior.
- The implementation may refactor WebGL route internals, but must not introduce
  Rust/wasm runtime communication.
