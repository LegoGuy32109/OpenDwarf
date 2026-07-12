# Engine MVP — Post-Review Fix Plan

**Status:** Locked — 2026-07-12  
**Parent:** [`engine-webgl-parity-cutover.md`](./engine-webgl-parity-cutover.md),
[`engine-mvp-abi-interview.md`](./engine-mvp-abi-interview.md)  
**Trigger:** Multi-model review of Slices 1–3 (`webgl-version...HEAD`)

Implement against `/webgl` parity spirit. Do not delete `/webgl`.

---

## Locked decisions

| # | Topic | Lock |
| --- | --- | --- |
| 1 | GL instance overflow | **A** — Split world `DrawCmd`s at `MAX_INSTANCES` (8192), mirror `/webgl` flush |
| 2 | Master FOV memory | **Match `/webgl`** — clear `visible` only; **keep `memory`** (less complexity than diverging) |
| 3 | Import / reset | **B + reset UI** — sync view without mutating sim chunk set after hash OK; `render_world`; harness reset clears `DomainEngine` session/shell |
| 4 | ViewGlobals DPR | **A** — write sampled `dpr` into `canvas[2]` |
| 5 | Duplicate render-pos | Single helper in **`od_world`**; delete wasm copy |
| + | Diagonals | Extend **`Dir`** to octants `N, NE, E, SE, S, SW, W, NW` (legacy Octant shape); live ESDF chords → full `Vec3i` |
| + | FOV cost | **`fov_dirty` flag** like `/webgl` — recompute only when dirty |
| + | Master streaming | Clamp viewport to world; never fallback to full-world window; fingerprint streaming applies |
| + | Mid-move visibility | Use **`entity.position`** (grid origin), not `occupies_target` — match `/webgl` player cull |
| + | Chat/shell sim | **Always tick sim**; only gate new move/view intents |

---

## Work packages

### WP1 — Draw batching + render helper

1. In `od_world::render`, when emitting floor quads, flush a `WorldAtlasQuad` `DrawCmd` whenever the open batch reaches **8192** (or `MAX_INSTANCES` const shared/documented with TS). Player stays its own cmd after floors.
2. Move `entity_render_position_xy` into `od_world` (e.g. `render.rs` or `movement` helper); `od_wasm` imports it.

### WP2 — FOV dirty + master memory + mid-move visibility

1. Add `fov_dirty: bool` (default true). Set dirty on: primary tile change, switch **to** entity mode, world reset/import, optional chunk-load under FOV radius.
2. Entity mode: `recompute_fov` **only if** `fov_dirty`; then clear dirty.
3. Master mode: `visibility.visible.clear()` only — **do not** `memory.clear()` (match `webgl2/runtime.ts` `processVisibility`).
4. Player visibility + FOV center use `player.position` (grid). Interpolated/smooth XY only for draw placement.

### WP3 — Octant `Dir` + live diagonals

1. Expand `od_core::world::intent::Dir` to eight variants with `to_vec3i` (N=`(0,-1,0)`, NE=`(1,-1,0)`, …).
2. Update Scenario keymap / builders / goldens as needed for serde compatibility (`snake_case` / existing JSON).
3. `direction_from_keys` returns full chord including diagonals (no collapse to cardinals).
4. Live path may still `MoveEntity { direction: dir.to_vec3i() }`.

### WP4 — Streaming clamp + fingerprint

1. Clamp camera tile AABB to world bounds before chunk conversion; empty ∩ → empty set.
2. Remove “full world extents” `unwrap_or` fallbacks.
3. Fingerprint desired streaming set; call `SetChunkLoaded` only on diff (like `streamingKeySet`).

### WP5 — Import / reset / DPR / chat tick

1. `import_replay_json`: after hash OK, install world; compute/`sync` view **without** applying chunk load/unload that changes authoritative `loaded_chunks` (or restore chunk set from imported snapshot); call `render_world` before returning snapshot.
2. Harness `reset_*`: also reset UI domain (shell closed, chat cleared); re-hydrate settings if needed.
3. `write_view_globals`: `canvas[2] = sampled.dpr` (or last known dpr from input).
4. `frame()`: always `advance_frame_sim_ticks`; world_context only gates movement/view key ingest.

### WP6 — Tests

- Batching: unit or harness that would exceed 8192 doesn’t overflow (or assert multiple floor cmds).
- FOV: second frame without move does not change visibility set / no redundant recompute (counter or dirty false).
- Diagonal: hold E+F (or S+E) starts diagonal move if terrain allows.
- Master: memory count preserved across `/master` → `/entity` (visible may clear).
- Mid-move: player cull uses origin tile (assert vs occupies_target divergence case if easy).
- Streaming: pan master off-map does not load all chunks.
- Import: returned `world_state_hash` equals replay final hash; chat open doesn’t freeze tick.

---

## Out of scope

Shadows/fog overlays, deleting `/webgl`/Bevy, pixel-diff CI, changing remembered-tint policy beyond master memory retention.

---

## Done when

All WPs landed, wasm rebuilt/committed, `deno task engine:check` + `tests/engine*.test.ts` green, adversarial parent review written.
