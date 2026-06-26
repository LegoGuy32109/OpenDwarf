# WebGL2 Parity Plan

This plan follows `docs/WEBGL2_REWRITE_PLAN.md` through slice 8, but resets the
cutover criteria around actual route parity. The goal is not "the new pass
registry exists"; the goal is that `/webgl2` can replace `/webgl` for gameplay
and rendering, after which the older route and renderer can be deleted.

## Goal

Make `/webgl2` behaviorally and visually equivalent to `/webgl` for all playable
route features:

- Same deterministic world seed and generated terrain.
- Same player spawn, walking, chained walking, terrain step-up/step-down, and
  blocked movement rules.
- Same keyboard controls for player movement, camera movement, z inspection,
  zoom, layer toggles, fullscreen, chat, and view mode commands.
- Same entity-follow mode and free/master view mode behavior.
- Same chunk streaming, solid cache coverage, FOV, remembered tiles, fog, floor
  stack, edge shadows, ceiling shadows, player sprite, chat bubbles, chat input,
  FPS/TPS, and status/debug UI behavior required for normal play.
- Same resize and fullscreen behavior.

When this plan is complete, `/webgl` should no longer be needed as a playable
route. Harness/replay/checkpoint support remains a separate decision because the
rewrite plan explicitly deferred it from WebGL2 v1.

## Current Observed Gaps

### State Ownership

`/webgl` owns a complete game state in `islands/WebGlGameCanvas.tsx` and passes
mutable refs through input, simulation, and rendering. `/webgl2` currently only
keeps `viewModeRef` in `webgl2-entry.ts` and creates the rest inside
`webgl2/render-loop.ts`.

Impact:

- Input cannot modify player, camera, chat, layer, z-level, or UI state.
- `buildFrameContext()` reconstructs render policy from hardcoded values instead
  of current route state.
- There is no single place to reset or inspect playable state.

### Player Movement

`/webgl` calls `startEntityMove()` from `processPlayerMovement()` using ESDF
keys (`E`, `S`, `D`, `F`) and loaded solid chunks. `/webgl2` only calls
`advanceWorldMovement(world)`.

Impact:

- The player never starts walking from keyboard input.
- Chained movement, just-pressed direction changes, facing direction, blocked
  move logging, and terrain-aware z movement do not exist on `/webgl2`.

### Camera And View Modes

`/webgl` supports:

- Entity mode: camera follows smoothed player position plus IJKL look offset.
- Master/free mode: IJKL pans the camera directly.
- `/master` and `/entity` chat commands switch modes.
- Zoom levels through `U` and `M`.

`/webgl2` supports:

- Hardcoded entity-follow camera at zoom `1`.
- `M` toggles `"entity"`/`"free"`, but this conflicts with old-route zoom-in
  behavior and does not match old `"master"` terminology.

Impact:

- IJKL does nothing.
- Zoom does not work.
- Camera always snaps to the entity-derived frame context.
- View mode controls differ from the old route.

### Z-Level Inspection

`/webgl` has an independent `viewZ` controlled by `R` and `V`; moving the view Z
does not move the player. `/webgl2` sets `viewZ` to `world.entity.position.z`
inside `buildFrameContext()`.

Impact:

- `R` and `V` do nothing.
- The player cannot be viewed through depth stacks independently from player Z.
- Topmost, FOV, shadows, player z-range, and occlusion are always tied to player
  Z.

### Layer Policy

`/webgl` supports layer toggles:

- `6`: floor
- `7`: edge shadows
- `8`: ceiling shadows
- `9`: depth tint

`/webgl2` hardcodes all layer flags to `true`.

Impact:

- Debug/inspection controls are missing.
- Pass enabled predicates cannot reflect route state.

### Chat And Commands

`/webgl` supports:

- `/` opens chat with slash prefilled.
- `T` opens regular chat.
- `Escape` closes chat.
- `Enter` submits.
- `Backspace` deletes one character.
- `Ctrl+Backspace` or `Shift+Backspace` deletes the previous word.
- While chat is open, movement and camera controls are suppressed.
- Non-command submissions create player-targeted chat bubbles.
- `/master` and `/entity` switch view mode.

`/webgl2` always passes empty `chatBuffer` and empty `chatBubbles` into the
frame context. `ChatPass` also always draws a "press enter to chat" panel, which
is not old-route behavior.

Impact:

- Chat input does not work.
- Chat bubbles never appear.
- Slash command view-mode switching does not work.
- Game controls are not suppressed by chat mode.
- The visible chat bar behavior differs.

### Chunk Streaming And Solid Cache Coverage

`/webgl` streams chunks from current camera plus a 3x3 player chunk safety
window in entity mode, and keeps solid chunks across a z band around both
`viewZ` and the player visibility position. `/webgl2` streams only from camera
visible/streaming region and calls `syncFloorAndSolidCaches()` inside frame
building.

Impact:

- Movement can fail with `chunk_unloaded` unless the player safety window is
  restored before movement starts.
- Solid cache coverage for FOV and step movement can diverge from `/webgl`.
- Cache churn and topmost rebuild timing differ from the old route.

### FOV Dirtying

`/webgl` only recomputes FOV when player position or view mode changes.
`/webgl2` calls `syncFovCache(world, viewMode)` every frame, and that calls
`recomputeFov()` every entity-mode frame.

Impact:

- Performance is worse than necessary.
- FOV memory timing can differ from `/webgl`.
- It hides missing dirty-state transitions that parity tests should catch.

### Visual Differences To Audit

The pass set exists, but several visual details need explicit comparison:

- Floor atlas frame selection: old route currently draws a fixed floor UV row in
  the single shader path, while `webgl2/passes/floor.ts` uses tile IDs.
- Ceiling shadow placement: old route writes centered positions with `+ HALF` in
  the unified shader path; WebGL2 writes tile origin positions through a
  dedicated shader. Confirm the dedicated shader expects origin.
- Entity-mode ceiling shadows: old route uses visibility/memory-aware
  `renderSolidAt()` for entity mode; WebGL2 uses `computeCeilingShadowIds()`
  against raw solid cache for all modes.
- Remembered-tile fog/tint: old route draws a light remembered overlay in
  addition to remembered floor tint; WebGL2 only applies fog alpha. Decide
  whether to port that overlay or intentionally drop it with visual sign-off.
- Chat input bar: old route only draws it while `uiMode === "chat"`; WebGL2
  draws a persistent prompt.
- HUD/debug UI: old route shows the detailed overlay only when `Digit1` is on;
  WebGL2 always shows a compact HUD.

### Resize And Fullscreen

Both routes support fullscreen, but `/webgl` clears input state and refreshes
capability/viewport state on fullscreen changes. `/webgl2` focuses the canvas
and resizes, but has no route state for fullscreen/capability/log updates.

Impact:

- Held movement keys may remain active across fullscreen/blur once movement is
  added unless old clear behavior is restored.
- UI state and test snapshots cannot report the same viewport/fullscreen data.

### Harness, Replay, Checkpoints, Canvas2D Fallback

The old route still exposes `globalThis.__openDwarfWebGlHarness`, replay import
/ export, checkpoint capture, screenshot baseline metadata, and a Canvas2D
fallback. `docs/WEBGL2_REWRITE_PLAN.md` explicitly excludes these from WebGL2
v1.

Decision:

- Do not block playable route deletion on these unless the project wants to keep
  the existing Playwright harness flow unchanged.
- If tests still depend on the harness, add a small WebGL2 parity harness or
  rewrite tests to inspect route state another way before deleting `/webgl`.

## Implementation Plan

### Phase 1 - Introduce Shared WebGL2 Game State

Create a dedicated WebGL2 game-state module that owns the mutable state
currently scattered across `/webgl`:

- World sim: `WorldSimState`.
- Camera: `{ x, y, zoom }`.
- `viewZ`.
- View mode, using old-route semantics: `"entity" | "master"` unless the whole
  project is intentionally renamed to `"free"`.
- UI mode: `"world" | "chat"`.
- Chat buffer, submitted messages, chat bubbles.
- Held player keys, just-pressed player keys, held camera keys.
- Camera look offset.
- Layer toggles.
- FOV dirty flag.
- Topmost dirty flag.
- Streaming key fingerprint.
- FPS/TPS counters and frame number.
- Logs/status if the HUD parity target includes the old overlay.

Acceptance criteria:

- `webgl2/render-loop.ts`, `webgl2/input.ts`, and `webgl2/frame-builder.ts` all
  consume the same state object.
- `buildFrameContext()` no longer derives camera, zoom, `viewZ`, or layers from
  hardcoded values.
- The state can be reset deterministically for tests/manual parity.

### Phase 2 - Port Input Semantics

Port old-route input behavior into `webgl2/input.ts`, excluding only replay file
input unless harness parity is explicitly reinstated.

Required controls:

- `F11`: toggle fullscreen.
- `Escape`: exit fullscreen, or close chat when in chat mode.
- `E/S/D/F`: player movement.
- `I/J/K/L`: camera look/pan.
- `/`: open chat with `/`.
- `T`: open chat empty.
- `Enter`: submit chat.
- `Backspace`: delete character.
- `Ctrl+Backspace` or `Shift+Backspace`: delete word.
- `R`: inspect one z-level up.
- `V`: inspect one z-level down.
- `U`: zoom out through `[0.25, 0.5, 0.75, 1.0, 1.5, 2.0]`.
- `M`: zoom in through the same levels, matching `/webgl`; do not use `M` as
  view-mode toggle.
- `Digit1`: old debug overlay toggle, if HUD parity includes it.
- `Digit6` through `Digit9`: layer toggles.

Required command behavior:

- `/master`: switch to master/free camera mode.
- `/entity`: switch to entity-follow mode.
- Unknown slash commands are ignored and logged.
- Non-command submissions create chat bubbles targeted at current player tile.

Acceptance criteria:

- While chat is open, movement/camera/z/zoom/layer inputs do not affect game
  state.
- Keyup and blur/fullscreen changes clear held key sets.
- Repeated keydown does not create duplicate just-pressed movement events.

### Phase 3 - Port Simulation Tick Behavior

Move the old route's simulation flow into WebGL2:

1. Accumulate RAF delta into fixed 20Hz sim ticks, capped at 3 ticks/frame.
2. On each tick, call `processPlayerMovement()`.
3. Call `advanceWorldMovement()`.
4. Sync scene player from world.
5. Recompute visibility only when dirty.

Use the old `islands/webgl/world-runtime.ts` logic as the reference, but place
the shared implementation somewhere neutral if both routes need it during the
transition.

Acceptance criteria:

- Holding `E/S/D/F` starts movement with `startEntityMove()`.
- Chained held movement continues after a tile finishes.
- Pressing a new direction during active movement can redirect according to the
  old rules.
- Movement respects loaded chunk checks, terrain step-up/step-down, diagonal
  blocking, and blocked move logging.
- Player facing changes when moving left/right.

### Phase 4 - Match Camera, ViewZ, Zoom, And Streaming

Reproduce old-route camera behavior:

- Entity mode follows smoothed player render position plus look offset.
- Look offset returns to zero when IJKL are released.
- Master/free mode pans camera directly with IJKL at `cameraSpeedPxPerS`.
- `viewZ` is independent from player Z and controlled by `R`/`V`.
- Zoom persists in camera state and affects visible/streaming region.

Reproduce old-route streaming behavior:

- Compute streaming chunks from camera and viewport with `STREAM_PADDING`.
- In entity mode, add the 3x3 player chunk window at current `viewZ`.
- Keep solid cache z coverage from
  `min(viewZ - Z_LEVELS_BELOW, visibilityZ - 6)` through
  `max(viewZ + 1, visibilityZ + 6)`.
- Process pending solid chunk generation in bounded per-frame batches if the old
  route's async-ish behavior is still needed for frame time.

Acceptance criteria:

- `R/R/V` changes inspected z-level without changing player position.
- IJKL changes look offset in entity mode and camera position in master mode.
- Zoom changes visible and streaming chunks.
- Movement does not fail solely because adjacent player chunks were not loaded.

### Phase 5 - Wire Render Policy And UI Data

Feed `FrameContext` from real state:

- `policy.viewMode`.
- `policy.layers`.
- `frame.camera`.
- `frame.viewZ`.
- `ui.chatBuffer`.
- `ui.chatBubbles`.
- `ui.fpsHistory`.
- `ui.simTpsDisplay`.
- Optional old overlay data: logs, resident chunk count, visible count, replay
  summary placeholders, checkpoint placeholders.

Align UI passes:

- Chat input bar should match `/webgl`: draw only while in chat mode, with the
  old text format and positioning.
- Chat bubbles should expire/fade and stack like the old route.
- HUD should either match the old overlay toggle model or be explicitly accepted
  as a WebGL2-only UI change before cutover.

Acceptance criteria:

- Typing `Thello Enter` creates a visible bubble and clears chat state.
- Typing `/master Enter` switches view mode and closes chat.
- `Digit6` through `Digit9` visibly affect pass output.
- FPS/TPS/status text reflects current state rather than hardcoded values.

### Phase 6 - Resolve Visual Diffs

Run side-by-side manual and automated comparisons against `/webgl` for the same
seed, viewport, camera, `viewZ`, player, view mode, and layer state.

Audit and fix:

- Floor tile frame/UV choice.
- Depth tint and remembered tint.
- Remembered overlay/fog behavior.
- Edge shadow extents and neighbor chunk coverage.
- Ceiling shadow atlas frame and positioning.
- Entity-mode ceiling shadow visibility behavior.
- Player sprite position, flip, tint, z gate, and occlusion.
- Chat bubble position and text metrics.
- Canvas background color and clear behavior.

Acceptance criteria:

- At the same state, screenshots are visually indistinguishable except for
  documented and approved WebGL2-only differences.
- Draw order is equivalent: floor, edge shadow, ceiling shadow, fog in entity
  mode, player, chat, UI/HUD.

### Phase 7 - Add Parity Verification

Add WebGL2 parity tests before deleting old code. Prefer tests that exercise the
new route directly instead of preserving the full old harness surface.

Minimum behavioral tests:

- Player movement: hold `E` or `F`; player tile changes and camera follows in
  entity mode.
- Chat suppression: open chat, type movement/camera keys, close chat; player and
  camera remain unchanged.
- Slash command: `/master` changes view mode; `/entity` changes it back.
- Master camera pan: switch to master, hold each IJKL octant, camera moves and
  player stays stable.
- Z inspect: `R/R/V` changes `viewZ`; player position is unchanged.
- Zoom: `U/M` changes camera zoom through the expected discrete levels.
- Layers: `6/7/8/9` toggle policy and pass visibility.
- Fullscreen/blur: held keys are cleared.

Minimum visual tests:

- Boot screenshot at default state.
- Entity-mode FOV/fog screenshot after movement.
- Master/free view screenshot with fog disabled.
- Different `viewZ` screenshot showing depth stack/player occlusion.
- Chat input and chat bubble screenshot.

If keeping the existing Playwright helper style, either:

- Add a small `__openDwarfWebGl2Harness` with only state snapshot, set camera,
  set player, set view mode, step tick, and screenshot capture; or
- Generalize `tests/helpers/harness.ts` to target either route and harness name.

Acceptance criteria:

- New WebGL2 tests pass without loading `/webgl`.
- Existing world-sim unit tests still pass.
- Manual smoke test confirms keyboard controls on `/webgl2`.

### Phase 8 - Cutover And Delete Old Route

Only start this phase after Phases 1-7 are complete.

Cutover steps:

- Repoint `routes/webgl.tsx` to the WebGL2 island/client.
- Delete `routes/webgl2.tsx` or make it redirect to `/webgl`.
- Delete `islands/WebGlGameCanvas.tsx`.
- Delete `islands/webgl/`.
- Delete old shader files and generated declarations:
  `islands/webgl/shaders/tile.vert`, `islands/webgl/shaders/tile.frag`,
  `islands/webgl/shaders.ts`, `islands/webgl/shaders.d.ts`.
- Delete or update old harness-only tests that intentionally targeted `/webgl`.
- Update docs and README references from the old implementation paths.

Acceptance criteria:

- App builds with no imports from `islands/webgl/`.
- No route links point to `/webgl2` as the primary playable route.
- `/webgl` has the new engine and all parity tests pass.

## Non-Goals Unless Reopened

These are not required for playable parity because the rewrite plan explicitly
deferred them:

- Replay export/import.
- Checkpoint capture.
- Screenshot baseline manifest management.
- Full `globalThis.__openDwarfWebGlHarness` compatibility.
- Canvas2D fallback.
- Capability info dump on canvas.
- Old event log panel, unless retained as the debug overlay parity target.

If these are required before deletion, add a Phase 7b and treat them as test
infrastructure parity, not renderer parity.

## Final Parity Checklist

- [ ] `/webgl2` boots with the same seed and spawn as `/webgl`.
- [ ] `E/S/D/F` movement works, including chained movement and terrain z
      transitions.
- [ ] `I/J/K/L` camera behavior matches entity and master modes.
- [ ] `/master` and `/entity` chat commands work.
- [ ] Chat input and bubbles work, and chat suppresses game controls.
- [ ] `R` and `V` inspect z-levels without moving the player.
- [ ] `U` and `M` zoom through old-route zoom levels.
- [ ] `6/7/8/9` layer toggles affect WebGL2 pass policy.
- [ ] FOV, memory, fog, floor, shadows, player, and UI visually match the old
      route.
- [ ] Resize/fullscreen behavior matches and clears held keys.
- [ ] WebGL2 parity tests pass without depending on old `/webgl`.
- [ ] A final side-by-side manual check has no unapproved visual or behavioral
      diffs.
- [ ] Old route files can be deleted without breaking build or tests.
