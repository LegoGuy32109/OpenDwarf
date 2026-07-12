# `/webgl` → `/engine` Parity Cutover Plan

**Status:** Round 1 locked; round 2 partial — 2026-07-12 (Q5/Q6 still open)
**Parent:** [`../GAME_ENGINE_ARCHITECTURE.md`](../GAME_ENGINE_ARCHITECTURE.md) →
Cutover; Phase 5+; parallel `od_world` track
**Companions:** [`text-input-and-chat.md`](./text-input-and-chat.md) (Phase 4),
[`od-world.md`](./od-world.md), [`sim-replay.md`](./sim-replay.md),
[`scenario.md`](./scenario.md), [`game-testing-harness.md`](./game-testing-harness.md),
[`render-command-abi.md`](./render-command-abi.md)
**Round-2 interview:** [`engine-mvp-abi-interview.md`](./engine-mvp-abi-interview.md)

This is the plan to bring **UI, textures, and basic game logic** onto `/engine`
so the deprecated `/webgl` (`webgl2/` + `lib/webgl-world-sim.ts`) **and** the
Bevy `/` + `game_library/` path can be deleted after you verify a playable MVP.
It is **not** the old `old_plans/WEBGL2_PARITY_PLAN.md` (that was `/webgl` →
`/webgl2` TS rewrite; already landed — `/webgl` now serves `WebGlGameCanvas2`).

---

## 0. Phase 4 verification (architecture Phase 4)

Architecture Phase 4 =
[`text-input-and-chat.md`](./text-input-and-chat.md) + session HUD/menu port.

### Done (matches “Done when” + module layout)

| Deliverable | Evidence |
| --- | --- |
| `Text` event kind + hidden `#od-text-capture` | `engine/input.ts`, `od_core` input arena |
| Wasm-authoritative text field + caret/scissor | `od_ui/src/text/{state,field}.rs`, draw scissor, `engine/runtime.ts` honors scissor |
| Chat open (`T`/`/`) / edit / submit / Escape-cancel | `od_ui` chat + router; goldens `chat_*` |
| `SessionModel` (`chat_draft`, `messages`) | `od_core/src/session.rs` |
| `host_set_text_capture` | `od_wasm` + `engine/runtime.ts` |
| Native + browser goldens for chat/shell | `od_ui/goldens/`, `tests/engine-golden.test.ts` |
| Shell ESC menu (Phase 3, still present) | `shell_root` / `shell_settings*` goldens |

### Explicitly deferred by Phase 4 design (not regressions)

- Chat **bubbles** / world-anchored message render → post-MVP (Phase 5 surfaces)
- Slash-command dispatch (`/master`, `/entity`) → with session/world model (MVP
  needs view-mode switching somehow — see round-2 interview)
- IME / selection / rebind UI → later seams already reserved

### Phase 4 soft gap

Architecture Phase 4 also says “HUD … into the session domain.” Today
`SessionDomain` builds a small session panel + chat bar
(`chat::build_session`), not the Digit1 FPS/mode/z/zoom overlay from
`webgl2/passes/hud.ts`. **MVP includes that HUD** (locked below).

**Verdict:** Phase 4 **text/chat/session-model** is finished. HUD + world
render / textures / movement are the cutover gap.

---

## 1. Locked decisions (interview round 1 — 2026-07-11)

| # | Decision | Lock |
| --- | --- | --- |
| **Q1** | World draw ownership | **Rust-authoritative ABI.** Expand the render-command ABI so Rust emits floor/player/(later shadow/fog) instances. TS only binds programs/textures and draws `DrawCmd` ranges. No long-lived hybrid where TS owns pass logic. |
| **Q2** | Cutover bar | **Playable MVP, then you verify.** Delete deprecated trees only after you confirm the MVP feels right in-browser. Shadows/fog/bubbles may land on `/engine` after cutover. |
| **Q3** | Terrain / sim source of truth | **`od_world` / `world_core`.** Controls + player experience must look right; byte-identical terrain vs `lib/webgl-world-sim.ts` is not required. |
| **Q4** | Bevy `/` + `game_library` | **Same cutover milestone.** When MVP is verified, remove Bevy route/`game_library` browser path together with `/webgl` + `webgl2/`. |

### Playable MVP definition (locked)

Ship on `/engine`, then you verify before delete:

1. **Floor** tiles (starter room / loaded chunks) via Rust-emitted instances
2. **Player** sprite (facing, interpolated position)
3. **Move** with ESDF → `WorldSim` (chained / terrain step rules from `od_world`)
4. **Camera** entity-follow + master pan (IJKL), **viewZ** (R/V), **zoom** (U/M)
5. **Chat** + **shell** (already Phase 3/4) + **session HUD** (mode/z/zoom/fps)
6. View-mode switch (`/master` `/entity` or equivalent) so camera modes are reachable

Explicitly **not** required before your delete verification:

- Edge/ceil shadows, fog/FOV remembered overlay, chat bubbles, layer toggles 6–9
- Worker offload, OPFS WAL, multiplayer, pixel-diff CI

---

## 2. Verification checks (2026-07-11)

| Check | Result |
| --- | --- |
| `deno task unit` | **Pass** — 26/26 (`chunk-gen` + `webgl-world-sim`) |
| Playwright `engine.test.ts` + `engine-golden` + `engine-harness` | **Pass** — 3/3 (~7s, prebuilt wasm) |
| `deno task engine:test` / `cargo test -p od_*` in this cloud image | **Blocked** — host Cargo 1.83 lacks stabilized `edition2024` (crate manifests require it). Prebuilt `engine/generated/` wasm is what browser tests exercise. Native goldens remain valid on a toolchain that matches the repo. |
| `od_world` in `od_wasm` | **Missing** — wasm exports UI only; `stepSimTick` / `importReplay` still throw Stage B stubs |
| World `ProgramId`s beyond Rect/Text | **Missing** — ABI doc reserves Sprite=`2`; floor/edge/ceil/fog not assigned |
| World atlas load on `/engine` | **Missing** — runtime loads white + UI font only; floor/shadow/sprite atlases used only by `/webgl` |
| Gameplay keymap (ESDF / camera held) | **Missing** — `gameplay_binding_for` maps IJKL→UI focus only; no `WorldIntent` / held camera sampling wired to sim |
| Bevy `/` still present | **Yes** — `routes/index.tsx` + `game_library/` + `static/game*` remain until MVP verify |

---

## 3. Current stack vs cutover target

| Layer | `/webgl` (reference) | `/engine` today | Cutover target |
| --- | --- | --- | --- |
| Route | `WebGlGameCanvas2` | `EngineCanvas` | `/engine` playable; `/webgl` + Bevy `/` removed after verify |
| Sim | `lib/webgl-world-sim.ts` | `od_world` **native only** | `WorldSim` in wasm; harness sim APIs real |
| Input | `webgl2/input.ts` | Arena → keymap → UI/session intents | + ESDF move, held IJKL camera, R/V/U/M |
| UI | chat + HUD | chat + shell panel | + Digit1-style session HUD |
| World pixels | floor/shadows/fog/player | UI only | MVP: floor + player via ABI |
| Harness | retired | v3 UI Scenario | + `stepSimTick` / `importReplay` |

---

## 4. Delivery slices (implementation order)

Design interviews for ABI/keymap/camera (round 2) land before Slice 1–3 coding.

### Slice 1 — Wasm `WorldSim` + movement

- Link `od_world` into `od_wasm`; export command/step/snapshot/hash.
- ESDF → move; fixed 20 Hz tick from RAF/`dt_ms`.
- Unstub `stepSimTick` + `importReplay`.
- **Done when:** Scenario + harness move the player; browser `world_state_hash` matches native for a small Scenario.

### Slice 2 — Camera / viewZ / zoom / streaming + HUD

- Local view state (name TBD in round 2): camera, viewZ, zoom, view mode.
- Entity follow + look / master pan from held IJKL; R/V; U/M; `/master` `/entity`.
- Streaming window → `SetChunkLoaded`.
- Session HUD (mode/z/zoom/fps|tps).
- **Done when:** snapshot exposes view fields; movement doesn’t fail from missing neighbor chunks.

### Slice 3 — World draw ABI MVP (floor + player)

- ABI: program IDs + homogeneous arenas for floor + sprite (round 2 locks layout).
- TS: load atlases; walk new programs; set camera globals from Rust-published view.
- Compositor: world cmds then UI cmds.
- **Done when:** floor + dwarf visible under UI; draw-hash covers world cmds.

### Slice 4 — Your verify + delete

- Manual playable MVP check (this is the gate).
- Delete `webgl2/`, TS world-sim, `/webgl` island/route (or redirect), Bevy `/` +
  browser `game_library` artifacts, leftover `phase0`, stale docs links.
- **Done when:** `rg` clean of retired paths; unit + engine e2e green on `/engine` only.

### Post-cutover (not gating delete)

- Shadows, fog/FOV, bubbles, layer toggles, Phase 5 surfaces/`ClientView`
  replication, workers, persistence.

---

## 5. What not to rebuild

- Do **not** re-wire `__openDwarfWebGlHarness`.
- Do **not** keep a TS pass-logic hybrid after Slice 3.
- Do **not** require worker/OPFS/netcode before MVP verify.
- Do **not** require pixel-diff CI; draw-hash + your eye verify.

---

## 6. Validation map

| Concern | Gate |
| --- | --- |
| Sim determinism | `od_world` native goldens + `world_state_hash` |
| Input → sim in browser | Scenario `WorldIntent` + harness `stepSimTick` |
| UI + world draw | draw-hash goldens (extend allowlist) |
| Playable feel | **Your** MVP verification before delete |
| Cutover | No imports from deleted paths; Bevy + `/webgl` gone |

---

## 7. Relation to old plans

| Doc | Role now |
| --- | --- |
| `old_plans/WEBGL2_PARITY_PLAN.md` | Historical — TS rewrite done |
| Architecture Phases 0–4 | Built (HUD folded into MVP) |
| Architecture Phase 5 | Post-MVP for full surfaces/net `ClientView` |
| This doc | Cutover bridge; round-1 decisions locked |
| `engine-mvp-abi-interview.md` | Round-2 questions before coding Slices 1–3 |
