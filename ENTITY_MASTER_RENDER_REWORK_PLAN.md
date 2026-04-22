# Entity/Master Render Rework Plan

## Goal

Fix the current split between `/master` and `/entity` so that:

- `/master` shows the full current z-level like the old behavior
- `/master` does not render unknown tiles
- `/entity` keeps the existing yellowish memory tint
- `/entity` keeps the current z-scrolling behavior through known memories
- movement in `/entity` does not force a full tilemap rebuild unless chunk
  membership actually changes
- deep holes can still stop rendering once they exceed the existing
  `Z_LEVELS_BELOW_RENDERED` budget

## Current Problems

### 1. Terrain rendering is coupled to FOV state

Right now the render-side terrain map is populated from
`snapshot.visible_blocks`, which is built from FOV-visible tiles plus memory.
That means the base floor pass is already visibility-filtered before the
renderer even decides whether it is in master mode or entity mode.

Effect:

- `/master` cannot truly mean "show all tiles on the current z-level"
- missing positions in the sparse map fall through as non-solid or unknown
  render behavior depending on pass
- fog policy and terrain availability are mixed together

### 2. Entity movement causes excessive tilemap rebuild work

The current tilemap projection path rebuilds the active render window whenever
`terrain.dirty` or `fog_data.dirty` is set. Because terrain data is derived from
the sparse visibility snapshot, ordinary movement in entity mode dirties the
same data path used for floor and shadow generation.

Effect:

- walking a small loop triggers repeated rebuilds across the entire active
  render window
- the warning logs are noisy even though the player only has a small amount of
  visible local context

### 3. Master and entity are using the wrong abstraction boundary

What you want is:

- same terrain presentation in both modes as a baseline
- entity mode adds observer-dependent fog/mystery treatment on top
- master mode removes that overlay and exposes the full current z-level view

What the code currently does is closer to:

- entity mode determines what terrain even exists in the render snapshot
- master mode only changes how an already-filtered snapshot is displayed

### 4. Startup chunk tracking is misleading

The sim starts with all chunks loaded, while the client-side chunk tracking
state starts empty. That creates startup warnings about the center chunk not
being tracked even though the sim already has those chunks loaded.

Effect:

- log noise at startup
- harder to see real chunk streaming problems

## Constraints From Review

These are explicit constraints for the rework:

- keep the existing yellowish memory tint in entity mode
- do not tighten entity z mode
- keep the current ability to move the entity view through remembered z-levels
- only treat chunk loads/unloads as chunk-membership changes during movement
- use named constants for fog colors/tints so the behavior is clear and tunable

## Target Architecture

## 1. Separate terrain data from visibility data

The renderer needs two distinct inputs:

- `TerrainData`: what blocks exist in the loaded/renderable world data
- `FogData`: what the observer currently sees, remembers, or has never seen

The terrain pass should no longer depend on FOV memory to know whether a tile
exists.

Expected result:

- `/master` can render the full current z-level from actual terrain data
- `/entity` can reuse that same terrain base and add fog on top

## 2. Make snapshots carry full terrain for rendering

Adjust the snapshot/update contract so the render world receives enough terrain
data to draw the loaded area independent of observer visibility.

The intended split is:

- terrain payload: full loaded render terrain
- visibility payload: entity-only visible/memory state

This change should happen in the sim snapshot path first, then in the
render-side apply path.

## 3. Make fog an overlay-only concern

After the terrain/visibility split:

- floor generation uses terrain only
- edge shadow generation uses terrain only
- ceiling shadow generation uses terrain only
- fog generation uses visibility only

This is the boundary that will let master mode stay complete while entity mode
adds mystery/fog without breaking terrain fidelity.

## 4. Split tilemap invalidation by layer responsibility

The current invalidation model is too coarse. Rework it so the render layers
only rebuild when their own source data changes.

### Terrain-driven rebuild triggers

These should rebuild floor and terrain-derived overlays:

- actual terrain payload changes
- chunk load/unload changes the active chunk set
- view z changes

### Fog-driven rebuild triggers

These should rebuild fog only:

- visibility visible-set changes
- visibility memory changes
- switching between `/master` and `/entity`
- view z changes

### Important rule

Ordinary movement in entity mode should not mark terrain dirty unless the player
crossed a chunk boundary that changed the stream window or the sim actually sent
new terrain data.

## 5. Preserve current entity-mode memory behavior

Entity mode should keep:

- the current remembered-area browsing behavior across memories
- the current yellowish remembered tint

To make that easier to tune and reason about, define constants for fog colors,
for example:

- remembered fog tint
- unknown fog tint

Do not change the actual remembered tint target in this rework unless a later
art pass asks for it.

## 6. Restore master mode semantics

Master mode should become:

- full terrain view for the current z-level
- normal below-layer rendering for the configured render depth
- no unknown overlay
- no remembered overlay

Master mode should not depend on whether a tile has been seen before. The only
remaining limit should be the existing render-depth budget for looking down into
very deep holes.

## 7. Clean up chunk tracking initialization

Bring client chunk tracking into alignment with sim startup state so the initial
center chunk is not reported as missing when it is already loaded.

Two acceptable approaches:

- initialize `ChunkStreamingState` from the initial desired player-centered
  window
- or change sim startup loading policy to match the streaming window model

The preferred choice is whichever requires the smaller semantic change while
keeping diagnostics honest.

## Implementation Phases

## Phase 1: Snapshot contract split

Update snapshot structures so terrain and visibility are no longer conflated.

Tasks:

- revise `WorldSnapshot` payload shape
- stop using visibility-sparse terrain as the base render terrain
- update snapshot construction in `world_core`
- update render-side snapshot application in `simulation`

Acceptance:

- render-side terrain data is complete for loaded/renderable terrain
- visibility remains available separately for entity-mode fog

## Phase 2: Render from terrain first

Update tile generation so the floor and structural overlays use complete terrain
data rather than sparse visibility-filtered data.

Tasks:

- update `build_chunk_tile_data`
- update edge shadow generation assumptions
- update ceiling shadow generation assumptions
- verify master mode no longer shows unknown gaps on the current z-level

Acceptance:

- `/master` displays the current z-level fully
- floor/shadow passes no longer depend on remembered visibility

## Phase 3: Fog becomes entity-only overlay

Keep the existing entity-mode mystery effect, but make it purely an overlay
pass.

Tasks:

- retain remembered tint behavior
- introduce named constants for fog colors
- ensure fog chunks only exist in entity mode
- ensure master mode removes fog chunks cleanly

Acceptance:

- `/entity` keeps the current map-like yellow memory treatment
- `/master` has no unknown or remembered overlay

## Phase 4: Dirty-state split for performance

Refactor tilemap rebuild scheduling so floor/shadow work and fog work can change
independently.

Tasks:

- separate terrain dirtiness from fog dirtiness at the resource level
- make movement-only visibility updates touch fog invalidation only
- keep terrain rebuilds tied to chunk window changes, terrain changes, and
  view-z changes
- keep fog rebuilds tied to visibility, mode, and view-z changes

Acceptance:

- walking inside the same chunk window does not rebuild the full terrain tilemap
- warnings about slow full rebuilds become much rarer during normal entity-mode
  movement

## Phase 5: Chunk tracking startup cleanup

Fix the mismatch between initial sim chunk state and initial client chunk
tracking.

Tasks:

- initialize chunk tracking consistently
- remove the bogus startup center-chunk warning
- verify chunk load/unload diagnostics still reflect actual stream behavior

Acceptance:

- no misleading startup warning about the center chunk being untracked

## Files Expected To Change

- `game_library/world_sim/src/world_api.rs`
- `game_library/world_sim/src/world_core.rs`
- `game_library/src/domain/simulation.rs`
- possibly `game_library/src/domain/mod.rs` if system ordering or resources need
  adjustment

## Acceptance Criteria

- `/master` shows all tiles on the current z-level
- `/master` does not show unknown tiles
- `/entity` keeps the existing yellowish memory tint
- `/entity` keeps the current z-level browsing behavior through remembered space
- walking around inside the same streamed chunk window does not force a full
  terrain/shadow tilemap rebuild
- chunk loads/unloads still trigger the necessary terrain rebuilds
- the startup center-chunk warning is removed unless there is a real tracking
  mismatch
- holes deeper than the configured render-depth budget may still stop rendering
  beyond that budget

## Validation Plan

After implementation:

1. Start in `/entity` and walk a tight loop within the starter room.
2. Confirm fog changes visually while full terrain rebuild warnings no longer
   fire on every move.
3. Switch to `/master`.
4. Confirm the current z-level is fully visible and contains no unknown overlay.
5. Move near holes and confirm lower levels still obey the existing
   `Z_LEVELS_BELOW_RENDERED` limit.
6. Verify startup logs no longer report the center chunk as missing from tracked
   loads.

## Notes

- This rework intentionally does not change the current entity z-range behavior.
- This rework intentionally does not retune the remembered fog color.
- The primary structural fix is separating base terrain rendering from
  observer-dependent fog state.
