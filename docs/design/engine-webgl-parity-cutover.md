# `/webgl` → `/engine` Parity Cutover Plan

**Status:** Draft — 2026-07-11 (awaiting interview lock on §8 decisions)
**Parent:** [`../GAME_ENGINE_ARCHITECTURE.md`](../GAME_ENGINE_ARCHITECTURE.md) →
Cutover; Phase 5+; parallel `od_world` track
**Companions:** [`text-input-and-chat.md`](./text-input-and-chat.md) (Phase 4),
[`od-world.md`](./od-world.md), [`sim-replay.md`](./sim-replay.md),
[`scenario.md`](./scenario.md), [`game-testing-harness.md`](./game-testing-harness.md),
[`render-command-abi.md`](./render-command-abi.md)

This is the plan to bring **UI, textures, and basic game logic** onto `/engine`
so the deprecated `/webgl` (`webgl2/` + `lib/webgl-world-sim.ts`) reference can
be deleted in one cutover. It is **not** the old
`old_plans/WEBGL2_PARITY_PLAN.md` (that was `/webgl` → `/webgl2` TS rewrite;
already landed — `/webgl` now serves `WebGlGameCanvas2`).

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

- Chat **bubbles** / world-anchored message render → Phase 5 surfaces
- Slash-command dispatch (`/master`, `/entity`) → session/`od_world` integration
- IME / selection / rebind UI → later seams already reserved

### Phase 4 soft gap (mechanical, called out in the design)

Architecture Phase 4 also says “HUD … into the session domain.” Today
`SessionDomain` only builds the chat bar (`chat::build_session`). The `/webgl`
Digit1 FPS/mode/z/zoom overlay (`webgl2/passes/hud.ts`) is **not** ported.
Treat as **Phase 4b** (below) or fold into the first world-visible slice — it
does not block declaring the text/chat vertical slice complete.

**Verdict:** Phase 4 **text/chat/session-model** is finished. Phase 4 **HUD
parity** is not. World render / textures / movement gameplay were never Phase 4
scope; they are the cutover gap.

---

## 1. Current stack vs cutover target

| Layer | `/webgl` (reference) | `/engine` today | Cutover target |
| --- | --- | --- | --- |
| Route | `routes/webgl.tsx` → `WebGlGameCanvas2` | `routes/engine.tsx` → `EngineCanvas` | `/engine` (or `/webgl` repointed) is the only playable GL game |
| Sim | `lib/webgl-world-sim.ts` (TS) | `od_world::WorldSim` **native only** — **not in `od_wasm`** | `WorldSim` in wasm; harness `stepSimTick` / `importReplay` real |
| Input | Direct DOM → `webgl2/input.ts` | Arena → keymap → intents | Keep engine path; add gameplay binds (ESDF, IJKL, R/V, U/M, 6–9) |
| UI | Passes: chat + HUD | IMGUI: chat + shell; no world HUD | Session HUD + bubbles + menus over `ClientView` |
| World pixels | Passes: floor, edge/ceil shadow, fog, player | **None** (UI rect/text only; white + font atlas) | Same visual stack, driven from wasm |
| Harness | Retired (`__openDwarfWebGlHarness` gone) | `__openDwarfEngineHarness` v3 | Extend snapshot for world; unstub sim APIs |
| Bevy `/` | Separate deprecated path | n/a | Separate retirement (not required to delete `/webgl`) |

`od_world` Increment 2 + Scenario A/B are **implemented** as headless/native
(+ browser Scenario lowering). Docs already state: no `/engine` world
rendering, no wasm world surface, FOV omitted from v1 snapshot.

---

## 2. Gap inventory (what must land before deleting `webgl2/`)

### A. Basic game logic (wasm sim + controls)

- Wire `od_world` into `od_wasm` (or a thin world handle beside `UiEngine`).
- Main-thread loop: accumulate RAF → fixed 20 Hz `step_ticks` / commands.
- Map ESDF → `WorldIntent::MovePlayer` / `WorldCommand::MoveEntity`.
- Chunk streaming policy (camera + entity 3×3 safety window) →
  `SetChunkLoaded`.
- Camera / `viewZ` / zoom / view mode (`entity`|`master`) as session or local
  client state (not necessarily networked).
- FOV + tile memory for entity-mode fog (missing from `od_world` v1 — needs an
  Increment 3 or render-local FOV module).
- Unstub harness: `stepSimTick`, `importReplay`; Scenario World steps in browser.

### B. Textures / world render

`/webgl` programs (must remain available until cutover, then move under
`engine/` ownership):

- Atlases: floor, edge shadow, ceil shadow, fog, player sprite
  (`static/assets/...`)
- Instance strides differ per program (e.g. floor = 7 floats) — **not** the
  current UI rect(8)/glyph(12) ABI

Architecture intent: TS stays a dumb draw-list walker. Today `ProgramId` is only
`Rect` | `Text`. World programs need an **ABI expansion design** (see §8).

Compositing order (already locked): world → world-anchored session UI → screen
HUD → shell.

### C. UI remaining for playable parity

- Session HUD (mode, z, zoom, fps/tps) — Phase 4b
- Chat bubbles (world-anchored) — Phase 5 surfaces
- Slash commands mutating view mode — with session/world model
- Layer toggles 6–9 if retained as debug policy

### D. Delete set at cutover

- `webgl2/` (except any GL modules absorbed into `engine/`)
- `lib/webgl-world-sim.ts`, `lib/webgl-chunk-gen.ts` (once `od_world` replaces)
- `islands/WebGlGameCanvas2.tsx`, leftover `islands/webgl/shaders/`
- `tests/unit/webgl-world-sim.test.ts` (replaced by `od_world` goldens)
- Docs/README links; remove `phase0.rs` scaffold if still present

---

## 3. Recommended delivery slices

Each slice ends with harness/golden evidence (draw-hash and/or
`world_state_hash`) before the next. Design interviews for unmarked items land
as separate `docs/design/*.md` before coding (architecture rule).

### Slice 0 — Lock decisions (§8) + Phase 4b HUD (optional parallel)

- Interview-lock world-draw ABI and cutover bar.
- Port compact session HUD from `webgl2/passes/hud.ts` into `SessionDomain`
  (screen placement only; reads stub/local camera fields until `ClientView`).

### Slice 1 — Wasm `WorldSim` surface (logic, no tiles yet)

- Export world handle from wasm: `new` / `send_command` / `step_ticks` /
  `snapshot_json` / `world_state_hash`.
- Engine runtime owns sim + applies movement intents from keymap (gameplay
  mode).
- Implement `stepSimTick` + `importReplay` on the harness.
- Browser Scenario World steps stop being fail-closed no-ops.
- **Done when:** hold E/F on `/engine` moves the entity in snapshot; native and
  browser `world_state_hash` agree for a small Scenario.

### Slice 2 — Client view + camera policy (still no tiles)

- Local `ClientView` (or minimal `SessionView`) projection: player, camera,
  `viewZ`, zoom, view mode, chat draft/messages.
- Port camera behaviors from `webgl2/runtime.ts` / render-loop (entity follow +
  look offset; master pan; R/V; U/M).
- Streaming window → chunk load commands.
- **Done when:** snapshot exposes camera/viewZ/zoom; master vs entity behave;
  movement no longer fails solely from missing neighbor chunks.

### Slice 3 — World draw ABI + texture boot

- Design + implement ABI for world programs (or interim hybrid — §8).
- Load floor/shadow/fog/sprite atlases on `/engine` boot (reuse
  `webgl2/texture-units.ts` / atlas loaders initially; relocate at cutover).
- Clear/compositor: world batches then UI draw-list.
- **Done when:** one seeded floor tile (or starter room) visible under UI on
  `/engine`; draw-hash includes world cmds.

### Slice 4 — Full visual parity passes

Port pass logic from `webgl2/passes/*` into the chosen ownership model:

1. Floor (topmost / depth tint / remembered tint)
2. Edge shadows
3. Ceiling shadows
4. Fog (entity mode)
5. Player sprite (facing, occlusion/z gate)
6. Chat bubbles (world-anchored IMGUI — activates Phase 5 floating-attach)

FOV: port or re-home from `webgl2/caches/fov.ts` / `od_world::fov` into the sim
or a deterministic client module hashed into snapshots as needed.

**Done when:** side-by-side `/webgl` vs `/engine` same seed/camera/viewZ is
acceptable by eye; browser goldens cover boot, move+fog, master view, chat
bubble.

### Slice 5 — UI/commands polish + delete

- Slash `/master` `/entity`; chat suppresses movement (already true for text
  capture — extend to any remaining gameplay keys).
- Layer toggles if still desired.
- Delete deprecated tree (§2.D); repoint routes; update AGENTS/README.
- Remove `od_ui` `phase0` leftover.

**Done when:** `rg` finds no `webgl2/` imports outside historical `old_plans/`;
`deno task unit` + engine e2e green; `/webgl` gone or redirects to `/engine`.

---

## 4. What not to rebuild

- Do **not** re-wire `__openDwarfWebGlHarness` — retired on purpose.
- Do **not** port Bevy `game_library` UI; `/` retirement is separate.
- Do **not** require worker offload / OPFS WAL / multiplayer before cutover —
  architecture parallel tracks; in-process wasm sim is enough for “basic game
  logic.”
- Do **not** require pixel-diff CI; draw-hash + eye parity (harness doc §8).

---

## 5. Validation map

| Concern | Gate |
| --- | --- |
| Sim determinism | `od_world` native goldens + `world_state_hash` |
| Input → sim in browser | Scenario with `WorldIntent` + harness `stepSimTick` |
| UI truth | Existing draw-hash goldens; extend allowlist for HUD/world |
| Textures / passes | Screenshots to `exports/` + `/opt/cursor/artifacts`; non-gating |
| Cutover | No imports from deleted paths; playable smoke on `/engine` |

---

## 6. Relation to old plans

| Doc | Role now |
| --- | --- |
| `old_plans/WEBGL2_PARITY_PLAN.md` | Historical — TS rewrite Phases 1–8 largely done (`/webgl` = webgl2) |
| `old_plans/WEBGL2_REWRITE_PLAN.md` | Historical pass registry |
| Architecture Phases 0–4 | **Built** (Phase 4 HUD soft gap above) |
| Architecture Phase 5 | Surfaces / `ClientView` — still needs design interviews |
| This doc | The cutover bridge from “UI shell works” → “delete `/webgl`” |

---

## 7. Suggested coding order (after §8 lock)

1. Slice 1 (wasm sim) — unblocks harness stubs and agent iteration
2. Slice 2 (camera/streaming) — unblocks correct chunk coverage
3. Slice 3 (first pixels) — unblocks visual agent artifacts
4. Slice 0 HUD can parallelize anytime after Slice 2 fields exist
5. Slice 4 pass-by-pass with goldens
6. Slice 5 delete

---

## 8. Open decisions (interview — not answerable from repo alone)

Everything else in this doc is derived from existing design + code. These need
an explicit lock:

### Q1 — World draw ownership

**A.** Expand render-command ABI so Rust emits floor/shadow/fog/sprite
instances; TS only binds programs/textures and draws ranges (matches
architecture “dumb TS”).

**B.** Interim hybrid: wasm publishes `ClientView` (+ maybe precomputed
instance buffers); keep `webgl2/passes/*` as TS consumers until ABI is ready,
then collapse.

Default recommendation if unspecified: **A**, with a thin interim if Slice 3
needs pixels before full ABI design lands — but do not invent a third long-lived
path.

### Q2 — Cutover bar (“delete `/webgl` when…”)

**A.** Full visual parity (all passes + FOV/fog + bubbles).

**B.** Playable MVP: floor + player + move + camera/z/zoom + chat/shell/HUD;
shadows/fog/bubbles can follow on `/engine` only.

### Q3 — Terrain / FOV source of truth

`od_world` ports `world_core` (may differ from `lib/webgl-world-sim.ts` noise).
Confirm: **eye parity against `/webgl` is “same controls + same pass look,” not
byte-identical terrain** — accept `od_world` terrain, or force a TS-sim match
first?

### Q4 — Bevy `/` in the same cutover?

Delete only `webgl2/` now, or also schedule `/` + `game_library` removal in the
same milestone?

---

## 9. Done when (whole plan)

- `/engine` is the playable browser game with textures and basic logic.
- Harness can step sim, import replay, and golden world+UI frames.
- Deprecated `/webgl` / `webgl2/` / TS world-sim deleted (or redirect-only).
- Phase 5 interviews for remaining surfaces/persistence/netcode can proceed
  without a second renderer to maintain.
