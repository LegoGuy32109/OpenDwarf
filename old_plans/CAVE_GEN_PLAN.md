# Cave Generation Plan

## Goal

Replace the current hardcoded 2D floor-fill terrain generation with
deterministic 3D cave generation that:

- works in native and wasm builds
- supports `world_chunks.z = 4` for a 64-layer world
- generates dense connected cave tunnel networks with many intersections
- allows caves to break through the surface for now
- keeps world generation logic inside `world_sim`
- keeps output deterministic enough for snapshot-based tests

This document is intentionally about cave generation, not the broader world
vision or final surface design.

## Current State

The current terrain generator in
[`game_library/world_sim/src/world_core.rs`](/home/josh/Projects/OpenDwarf/game_library/world_sim/src/world_core.rs)
is a 2D sinusoidal surface pattern that fills stone downward for a fixed `16`
levels. It is not a true volumetric generator.

Current constraints and assumptions:

- the game config still uses `world_chunks.z = 1`
- terrain is generated directly in `world_core`
- the player currently spawns at `Vec3i::ZERO`
- render/view code contains some z-range assumptions that will need cleanup
- determinism matters for replay and testing
- wasm compatibility matters for the final implementation

## Decisions Already Made

- Focus on cave noise first, not surface shaping.
- Caves may break through the surface at this stage.
- Prefer a few natural entrances.
- Prefer one dense connected tunnel lattice with many intersections over
  isolated pockets.
- All 64 layers should be affected by cave generation once `world_chunks.z = 4`.
- World bottom can remain a simple cutoff for now.
- Spawn should keep the current player `x`/`y` and place the player at the
  highest `z` where the current tile is air and the tile below is solid.
- Determinism is required and should be tested with snapshot-style coverage.
- Canonical test seeds are `opendwarf`, `josh`, and `karly`.

## High-Level Design

Use a volumetric density field for all terrain generation.

At each voxel `(x, y, z)`:

1. Sample a deterministic 3D noise function.
2. Compare the result against a threshold.
3. Emit:
   - `SolidStone` when density is considered solid
   - `Air` when density is considered carved

For this stage, there is no separate surface function. The full world volume is
subject to the cave noise. Surface openings are acceptable.

This is deliberately simple. It gives us a real 3D cave generator first, and we
can later layer in surface rules, crust depth, biome logic, or spawn-area
guarantees on top of it.

## Generator Shape

The first implementation should use anisotropic 3D noise:

- `x` and `y` use one frequency
- `z` uses a lower frequency than `x` and `y`

This should make caves vary more slowly vertically, which should produce more
horizontally navigable cave bands.

Conceptually:

```text
density = noise(x * freq_xy, y * freq_xy, z * freq_z)
solid if density <= threshold
air if density > threshold
```

Where:

- `freq_z < freq_xy`
- threshold is tuned to bias toward dense connected tunnels and intersections
  rather than isolated bubbles

## Determinism Requirements

The implementation must be deterministic across native and wasm targets.

That means:

- no runtime randomness in terrain generation unless it is seeded and stable
- the generator must take an explicit world seed
- tests should verify that the same config yields the same block snapshot
- the chosen noise implementation must behave consistently in wasm

Implementation rule:

- keep world generation pure from `WorldConfig` plus a terrain config
- do not depend on time, thread scheduling, or platform-specific randomness

## Wasm Constraints

The cave generator must stay inside normal Rust code that compiles for:

- native
- `wasm32`

Requirements:

- avoid platform-specific APIs
- avoid `unsafe`
- prefer a small deterministic noise crate with no native-only dependencies,
  even if it is Perlin-like rather than strict Perlin by name
- keep the generated block pass straightforward so wasm cost stays predictable

We should assume the web build path is a real compatibility target, not a later
cleanup task.

## Proposed Refactor

### 1. Introduce terrain configuration in `world_sim`

Add a terrain-specific config struct under `world_sim` so generation rules are
not hidden in constants inside `make_initial_blocks`.

Proposed shape:

```rust
pub struct TerrainConfig {
    pub seed: u32,
    pub cave_frequency_xy: f64,
    pub cave_frequency_z: f64,
    pub cave_threshold: f64,
}
```

This can grow later, but it is enough for the first cave-only pass.

Then extend `WorldConfig` to include terrain settings.

### 2. Move generation behind explicit helper functions

Replace the current inline terrain fill with helpers such as:

```rust
fn generate_initial_blocks(config: &WorldConfig, block_count: usize) -> Vec<BlockType>
fn generate_block_at(world_position: Vec3i, config: &WorldConfig) -> BlockType
fn sample_cave_density(world_position: Vec3i, terrain: &TerrainConfig) -> f64
```

This keeps world generation testable and gives us a clear seam for later surface
logic.

### 3. Replace hardcoded `16`-floor logic with full-volume generation

The generator must iterate the entire world volume:

- `world_chunks.x * chunk_edge`
- `world_chunks.y * chunk_edge`
- `world_chunks.z * chunk_edge`

and classify every voxel independently.

This removes the current fixed-depth behavior and makes `world_chunks.z = 4`
actually meaningful.

### 4. Raise the world depth in the game config

Once the generator is ready, update the game-side default config to:

```rust
world_chunks: Vec3u::new(16, 16, 4)
```

This should happen after the generator and spawn logic are in place, not before.

### 5. Add spawn validation logic

The current spawn-at-origin behavior is not valid once the terrain becomes fully
volumetric.

We need a spawn finder that returns a walkable tile near the top of the world.

Minimum validity rules:

- spawn tile is `Air`
- tile below is `SolidStone`
- tile is within world bounds

Initial search strategy:

1. keep the current player `x` and `y`
2. search from the top z downward on that column
3. accept the first valid walkable tile

This is a minimal behavior change to stop floating spawns without coupling spawn
to a later surface refactor or broader entry-generation logic.

### 6. Clean up z-range logic that assumes a shallow world

Before or alongside the deeper world rollout, remove manual z-bound assumptions
and derive view bounds from real world dimensions.

This especially applies to:

- view z clamping
- render chunk selection
- chunk streaming radius on z

### 7. Add deterministic tests before tuning

Tests should land as part of the refactor, not after tuning.

## Test Plan

### Unit and snapshot-style tests in `world_sim`

Add tests for:

1. `same_seed_same_blocks`
2. `different_seed_changes_blocks`
3. `multi_chunk_z_world_generates_expected_block_count`
4. `generated_world_contains_some_air_and_some_stone`
5. `spawn_finder_returns_walkable_tile`

### Suggested assertions

For a fixed config:

- block vector length matches total voxel count
- generator is stable across repeated runs
- world is not all air
- world is not all stone
- spawn tile is air and supported by stone below

### Snapshot strategy

Avoid checking the entire full block array directly in a brittle text fixture
for large worlds.

Prefer both:

- a stable hash of the block array for a few fixed seeds/configs
- a compact textual slice dump of selected z-levels

The tests should catch unintended generator changes without making tuning
impossible.

## First Implementation Sequence

### Step 1

Add a terrain config to `world_sim` and thread it through `WorldConfig`.

### Step 2

Pick and integrate a deterministic noise crate that works in wasm.

### Step 3

Replace the current 2D terrain generation with full-volume 3D density sampling.

### Step 4

Add deterministic tests for block generation.

### Step 5

Implement spawn search near the top of the world.

### Step 6

Raise `world_chunks.z` from `1` to `4`.

### Step 7

Fix z-bound and render assumptions exposed by the deeper world.

### Step 8

Tune `freq_xy`, `freq_z`, and `threshold` using observed results.

## Initial Tuning Direction

Start with:

- medium `freq_xy`
- lower `freq_z`
- threshold tuned toward dense tunnel connectivity

The first tuning pass should optimize for:

- dense connected tunnels with many intersections
- horizontal navigability
- visible vertical continuity without excessive jaggedness

Do not optimize for:

- pretty surface behavior
- biome variety
- ore placement
- polished spawn entrances

## Risks

### 1. Overly disconnected caves

If the threshold is too strict or frequency is too high, the result may become
small isolated pockets instead of the desired tunnel lattice.

### 2. Too much vertical noise

If `freq_z` is too close to `freq_xy`, caves may become difficult to traverse
horizontally because each z-layer changes too aggressively.

### 3. Spawn failure

A fully volumetric cave field can easily produce no obvious valid top spawn on a
given `x`/`y` column unless we explicitly search for one.

### 4. Wasm performance

Generating the entire volume is straightforward but more expensive than the
current 16-floor fill. We should keep the math simple and test build/runtime
behavior after implementation.

### 5. Hidden z-assumption bugs outside generation

Deeper terrain will expose systems that silently assumed one z-chunk.

## Open Questions To Resolve Before Coding

### Noise choice

1. Which specific noise crate should we choose once we compare wasm footprint
   and determinism behavior?
2. Do we want one noise field only, or should we expose plumbing for a second
   field even if it is unused initially?

### Spawn behavior

3. If the current player `x`/`y` column has no valid supported air tile, should
   spawn fail, fall back to a nearby column search, or carve a minimal valid
   tile?

### Rendering follow-up

4. Once cave generation lands, should depth tint remain the only z-visual
   distinction for solid stone until tile variation is revisited?

## Recommended Answers

Unless you want different constraints, the cleanest first pass is:

1. use one deterministic 3D noise field
2. keep the world mostly solid with caves carved from it
3. bias toward dense connected tunnels and many intersections
4. keep spawn on the player's current `x`/`y` column and choose the highest
   valid supported tile
5. use both block hashes and selected slice dumps in test plumbing
6. start with 3 fixed seeds: `opendwarf`, `josh`, and `karly`

## Out of Scope For This Document

- final surface generation
- biome generation
- ore or resource placement
- pathfinding changes
- vertical traversal mechanics
- visibility/fog/shadow design

## Exit Criteria For The First Cave-Gen Milestone

This milestone is complete when:

- `world_sim` generates terrain using 3D deterministic cave noise
- the generator uses the full z-depth of the world volume
- the game can run with `world_chunks.z = 4`
- player spawn lands on a valid supported tile
- tests verify determinism and basic terrain sanity
- the implementation builds for the wasm target path used by the repo
