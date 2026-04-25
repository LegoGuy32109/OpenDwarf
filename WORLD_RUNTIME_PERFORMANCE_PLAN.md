# World Runtime Performance Plan

## Goal

Refactor the browser and native runtime architecture so that:

- browser movement stays responsive under load
- the main thread remains smooth for input, menus, and typing
- native and web share the same logical runtime model
- telemetry is first-class and useful for both humans and LLMs
- the current snapshot-driven, broad dirty-rebuild render path is replaced with
  a chunk/layer patch-driven runtime

This plan treats performance architecture as a product feature, not a cleanup
pass.

## Final Architecture

### Crates and Ownership

- `world_sim`
  - pure simulation logic
  - no browser worker policy
  - no render-specific patch ownership
- `world_runtime`
  - protocol structs
  - bincode encode/decode
  - scheduler
  - dirty region merge/coalesce
  - telemetry/session lifecycle
  - short/long LLM-friendly reports
  - native threaded backend
  - web worker backend
  - single public `RuntimeHandle`
- main game client
  - ECS-owned chunk cache
  - runtime bridge
  - chunk/layer render entities
  - Bevy-facing render systems
  - F1 telemetry UI
  - browser `localStorage` perf session persistence
  - native repo-local perf session persistence

### Runtime Model

- authoritative sim tick remains `20 Hz`
- startup uses progressive near-first full visible snapshot
- steady state uses incremental whole-chunk layer patches
- resync uses the same full visible snapshot path as startup
- layer toggles (`6-0`) are sent into runtime so unnecessary layers stop being
  generated
- camera center is patch priority input #1
- desired world bounds are patch priority input #2
- overfetch is dynamic and collapses to zero before more important work is
  sacrificed
- stale visuals are allowed to remain for `250 ms`

### Render Model

- cache lives inside ECS
- cache truth lives in resources
- visible chunk/layer render state lives in long-lived entities
- one render entity per `ChunkKey + LayerId`
- separate entities per floor / edge shadow / ceiling shadow / fog
- whole-chunk updates only for v1
- same render path on web and native
- render stays within standard Bevy 2D primitives

## Protocol and Event Model

All packet/event structs live in `world_runtime`.

### Inbound to Runtime

- `ViewportIntent`
  - threshold-based updates only
  - camera center
  - zoom
  - desired bounds
  - relevant z range
  - active layer mask
  - view mode
- `InputBatch`
- `RuntimeControl`
  - shutdown
  - resync request
  - future report/control hooks if needed

### Outbound from Runtime

- `SessionStarted`
- `RuntimeReady`
- `InitialSnapshotStarted`
- `InitialSnapshotProgress`
- `InitialSnapshotChunkLayer`
- `InitialSnapshotEntities`
- `InitialSnapshotComplete`
- `ChunkLayerPatch`
- `EntityPatchBatch`
- `TelemetryFrame`
- `LayerSnapshotStarted`
- `LayerSnapshotProgress`
- `LayerSnapshotComplete`
- `ResyncStarted`
- `ResyncChunkLayer`
- `ResyncEntities`
- `ResyncComplete`
- `RuntimeWarning`
- `RuntimeFault`
- `SessionEnded`

### Patch Identity

- shared `worker_frame_id` for coherence/debugging
- independent `chunk_revision` per `ChunkKey + LayerId`
- newest revision wins
- superseded queued patches are dropped aggressively

### Layer Payload Strategy

Keep packet headers shared, but layer payloads specialized.

- floor: room for `tile_id + variant`
- edge shadow: minimal layer-specific payload
- ceiling shadow: minimal layer-specific payload
- fog: visibility-specific payload

If a layer later needs more information, rewrite the runtime protocol with the
next runtime change. Do not over-generalize v1.

## Telemetry and Reports

Telemetry starts immediately:

- browser: on page load in `/?perf`
- native: on process start

### Session Statuses

- `starting`
- `running`
- `completed`
- `aborted`
- `crashed`
- `desynced_resync`

### Required Metrics

- frame time `p50/p95/max`
- worker sim tick time
- FOV time
- patch build time
- serialization time
- patch apply time
- queue depths
- chunk counts by hot/warm/cold residency
- chunk load/unload counts
- active visible chunk layer count
- stale chunk count
- dropped superseded patch count
- coalesced patch count
- snapshot coverage progress

### Exports

- short text report
- long text report
- JSON session blob

Short report:

- summary only

Long report:

- summary
- recent spikes
- recent warnings/events
- queue and stale stats

### Persistence

- browser `/?perf`: automatic `localStorage` persistence for every session,
  including short-lived sessions
- native: automatic repo-local persistence in `.perf_sessions/`
- native should also print a useful stdout summary on exit or major fault

Recommended path layout:

- `.perf_sessions/native/`
- `.perf_sessions/native/<timestamp>__native__perf__build-<id>.json`
- `.perf_sessions/native/<timestamp>__native__perf__build-<id>.txt`

`.gitignore` should include:

```gitignore
.perf_sessions/
```

## Scheduler Rules

Runtime scheduling should be budgeted and priority-driven.

### Queues

- `critical`
  - due sim tick
  - input ingestion
  - entity state updates
  - near-camera dirty chunk/layer work
- `visible`
  - work inside desired bounds
- `prefetch`
  - dynamic overfetch ring
- `maintenance`
  - warm-cache upkeep
  - telemetry housekeeping

### Work Order Per Cycle

1. ingest latest viewport intent
2. run due `20 Hz` sim tick
3. collect terrain/FOV/visibility invalidations
4. merge invalidations into chunk/layer work items
5. sort by camera distance first, desired bounds second
6. spend budget on `critical`, then `visible`, then `prefetch`, then
   `maintenance`
7. emit patches progressively
8. emit telemetry

### Overload Ladder

When the runtime is overloaded:

1. shrink overfetch radius toward zero
2. stop maintenance work
3. merge regions more aggressively
4. drop superseded queued patches
5. defer far-region work
6. preserve main-thread responsiveness and near-camera updates first

### Degradation Philosophy

The renderer and UI must remain smooth even if the sim is struggling.

Treat the runtime like a stressed server:

- input, typing, menus, and camera remain clean
- render uses latest available entity/chunk data
- non-essential work bends before core interaction bends

## Render Cache Rules

Render cache lives inside ECS.

### Resources

- `RuntimeBridge`
  - owns `RuntimeHandle`
- `ChunkCacheState`
  - residency budgets
  - memory estimates
  - stale grace window
- `ChunkLayerCacheMap`
  - keyed by `ChunkKey + LayerId`
  - latest revision
  - last `worker_frame_id`
  - residency state
  - stale timestamp
  - decoded payload
  - dirty/materialized flags
- `PatchApplyQueue`
  - pending runtime events already coalesced by newest revision
- `ViewportIntentState`
  - camera center
  - zoom
  - desired bounds
  - z range
  - active layer mask

### Components

- `ChunkLayerRenderEntity`
  - `ChunkKey`
  - `LayerId`
- `ChunkLayerResidency`
  - hot / warm / cold
- `ChunkLayerMaterialized`
  - whether Bevy-facing render state exists

### Residency Model

- `hot`
  - intersects desired bounds
- `warm`
  - recently relevant
  - just outside desired bounds
- `cold`
  - evictable

Warm cache policy:

- limited by chunk-count budget and memory budget
- biased by recent camera history and predicted direction
- only relevant z ranges
- discarded first when runtime pressure rises

### Apply Order Per Frame

1. poll runtime events
2. enqueue into `PatchApplyQueue`
3. drop superseded revisions
4. write payloads into `ChunkLayerCacheMap`
5. update hot/warm/cold residency
6. materialize/update nearest hot chunk-layer entities first
7. update warm entities if budget remains
8. mark entries stale after `250 ms`
9. request full visible-region resync on mismatch/fault

## Startup, Snapshot, and Resync Rules

### Startup

1. session enters `starting`
2. runtime backend starts
3. initial viewport intent is sent immediately
4. runtime emits `InitialSnapshotStarted`
5. runtime emits chunk layers near-first progressively
6. runtime may emit entity updates immediately
7. runtime emits `InitialSnapshotComplete`
8. session enters `running`

### Progressive Startup Rules

- nearest available chunks render immediately
- missing chunks remain absent until data arrives
- no global wait for far chunks
- F1 should show snapshot progress

### Layer Toggle On

When a disabled layer is toggled back on:

1. render updates local layer mask immediately
2. new `ViewportIntent` is sent
3. runtime emits `LayerSnapshotStarted(layer)`
4. runtime emits full visible-bounds snapshot for that layer
5. runtime emits `LayerSnapshotComplete(layer)`

Layer stays absent until fresh data arrives.

### Resync

Resync should be blunt, not surgical:

1. render detects mismatch/fault
2. render sends `request_resync`
3. runtime emits `ResyncStarted`
4. runtime sends full visible-region chunk-layer snapshot plus entities
5. render replaces cache truth in region
6. runtime emits `ResyncComplete`

## Browser-Specific Plan

### `/?perf`

Add a release-like perf browser path:

- route via `/?perf`
- serve artifacts from `/game_perf/`
- enable COOP/COEP only in perf mode
- prefer `SharedArrayBuffer` fast path there
- keep fallback transferable path for compatibility

### Browser Compatibility Strategy

Priority:

1. Chrome
2. Safari
3. Firefox

Approach:

- same logical runtime protocol everywhere
- Chrome gets the best fast path first
- Safari/Firefox remain functional on fallback transport

## Native-Specific Plan

### Default Runtime

Native multithreaded runtime should become the default local path as soon as
functional.

Old single-threaded native path should be replaced, not kept as the primary
path.

### Telemetry

Native should automatically emit:

- stdout summary
- repo-local session files
- same short/long report structure as browser perf mode

This is required so browser and native telemetry can be compared directly.

## Phase Plan

## Phase 0: Pre-Refactor Baseline and Scaffolding

### Purpose

Establish baseline measurements and create the repo structure needed for the
refactor.

### Tasks

- add `.perf_sessions/` to `.gitignore`
- create `world_runtime` crate
- define module layout for runtime, telemetry, reports, scheduler, backend
- document build IDs/session IDs
- add baseline timing hooks around the current runtime/render path

### Deliverables

- `world_runtime/` crate exists and builds
- repo-local perf artifact folder is ignored
- baseline metrics can be emitted from native and current browser path

### Exit Criteria

- baseline reports can be collected before major refactor work begins

## Phase 1: Runtime Crate and Telemetry Foundation

### Purpose

Move telemetry, reports, session lifecycle, and protocol/event definitions into
`world_runtime`.

### Tasks

- define `RuntimeHandle`
- define event structs
- define `ViewportIntent`, `InputBatch`, `RuntimeControl`
- implement short/long report builders
- implement session lifecycle state machine
- standardize bincode serialization for runtime events

### Deliverables

- `world_runtime` compiles as source of truth for runtime protocol and telemetry
- reports are available to native and web callers

### Exit Criteria

- main client can import runtime types instead of defining ad hoc runtime/debug
  structures

## Phase 2: Native Threaded Runtime Default

### Purpose

Make native local builds use the new runtime model first.

### Tasks

- implement native threaded backend in `world_runtime`
- wire one public `RuntimeHandle` to native adapter
- make multithreaded native runtime the default local path
- persist native sessions automatically to `.perf_sessions/`
- emit stdout summaries automatically

### Deliverables

- local/native uses threaded runtime by default
- telemetry sessions are written automatically

### Exit Criteria

- `deno task local` equivalent native path runs on threaded runtime and produces
  perf artifacts

## Phase 3: `web-perf` and Perf Session Infrastructure

### Purpose

Create a realistic browser perf path that is safe to optimize against.

### Tasks

- add `deno task web-perf`
- create `/game_perf/` artifact path
- route `/?perf`
- enable COOP/COEP only for perf mode
- persist browser sessions automatically from page load
- replace F1 perf-mode debug content with telemetry-first UI
- add `Copy Short Report` and `Copy Long Report`

### Deliverables

- perf browser mode exists and is separate from debug browser mode
- browser sessions persist automatically
- F1 is telemetry-first in perf mode

### Exit Criteria

- browser perf investigations can use `/?perf` with persisted sessions and
  copyable reports

## Phase 4: ECS Chunk Cache and Runtime Bridge

### Purpose

Replace snapshot-driven render ownership with ECS-owned cache and runtime event
ingestion.

### Tasks

- add ECS resources for runtime bridge, cache state, cache map, patch queue,
  viewport intent
- add chunk-layer render entity model
- implement cache residency logic hot/warm/cold
- implement stale grace rules
- implement startup/resync/layer-snapshot event flow into ECS

### Deliverables

- render client owns chunk/layer cache inside ECS
- runtime events become the canonical source for render updates

### Exit Criteria

- render no longer depends on full-world snapshot sync as the primary model

## Phase 5: Visible Chunk Render Path Replacement

Status: completed as the default runtime path. The renderer now consumes
runtime `ChunkLayerPatch` payloads directly; the temporary cutover flag and
legacy broad tilemap rebuild system have been removed.

### Purpose

Replace the current broad tilemap rebuild path with a chunk/layer renderer
designed for runtime patches.

### Tasks

- refactor visible chunk rendering at the same time as runtime/cache cutover
- keep one entity per `ChunkKey + LayerId`
- keep layers separate to preserve debug toggles and reasoning
- use whole-chunk updates in v1
- stay inside Bevy 2D primitives

### Deliverables

- new visible chunk render path is active on web and native
- layer visibility toggles are preserved

### Exit Criteria

- old visible chunk render path deleted

## Phase 6: Browser Worker Backend

### Purpose

Move browser sim/FOV/patch generation off the main thread while keeping the same
public runtime handle.

### Tasks

- implement web worker backend in `world_runtime`
- add SAB fast path in perf mode
- add transferable fallback path
- keep one logical protocol across native and web
- feed patches progressively near-first

### Deliverables

- browser runtime uses worker backend
- main thread receives runtime events instead of sim ownership

### Exit Criteria

- browser main thread remains responsive under runtime load

## Phase 7: Layer-Aware Runtime and Snapshot Rules

### Purpose

Stop generating unnecessary work and finalize progressive snapshot behavior.

### Tasks

- send active layer mask into runtime
- stop generating disabled layers
- progressive near-first initial snapshot
- full visible-bounds snapshot when layer is toggled back on
- explicit snapshot progress/complete events

### Deliverables

- runtime workload reflects active layer mask
- progressive startup and layer recovery are explicit and measurable

### Exit Criteria

- layer toggle cost is visible in telemetry and runtime no longer computes
  disabled layers

## Phase 8: Backpressure, Overfetch, and Cache Tuning

### Purpose

Tune the runtime for chain reactions, camera outrun, and real-world
browser/native stress.

### Tasks

- implement dynamic overfetch
- implement warm-cache heuristics using hardware/runtime class
- aggressively drop superseded patches
- refine coalescing rules
- prioritize near-camera chunks first
- reduce or disable overfetch before sacrificing more important work

### Deliverables

- runtime behaves predictably under heavy terrain churn and rapid camera
  movement
- telemetry clearly shows why work was deferred or dropped

### Exit Criteria

- chain-reaction scenarios and greedy camera movement remain debuggable and
  locally responsive

## Phase 9: Cleanup and Release Convergence

Status: completed for the runtime/render hot path. Obsolete snapshot-driven
render systems, cutover controls, stale tilemap diagnostics, and main-thread
simulation debug surface have been removed. WebRTC debug warnings remain
outside this runtime-render cleanup.

### Purpose

Collapse proven perf settings into the standard release-oriented browser path
and remove obsolete code.

### Tasks

- remove obsolete snapshot-driven systems
- remove obsolete single-thread assumptions
- collapse validated perf settings into `web-release`
- ensure `web-perf` stays useful only if still needed as a distinct path
- clean out dead debug surface replaced by telemetry-first tooling

### Deliverables

- runtime architecture is the default path for native and web
- release builds inherit the validated perf architecture

### Exit Criteria

- no legacy runtime/render architecture remains on the hot path

## Validation Strategy Per Phase

Every phase should validate with:

- native automatic perf session file
- browser `/?perf` perf session
- short report
- long report

Always compare:

- frame latency
- worker/native runtime latency
- startup snapshot progress and completion
- stale chunk count
- dropped/coalesced patch counts
- visible chunk layer counts
- failure/resync lifecycle

## Implementation Order Recommendation

If executing this as code work, use this order:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8
10. Phase 9

This order gets telemetry and native convergence first, then the browser worker
and renderer cutover, then tuning.

## Risks

### Risk: Runtime and renderer are refactored simultaneously

This is intentional, but risky. The mitigation is keeping startup/resync blunt
and measurable.

### Risk: ECS cache growth creates new memory pressure

Mitigation:

- hot/warm/cold residency
- hard chunk-count limits
- estimated memory budget
- aggressive warm-cache decay under pressure

### Risk: Browser transport becomes the bottleneck

Mitigation:

- start with bincode packet structs
- measure serialization costs explicitly
- add SAB fast path for perf mode first

### Risk: Snapshot progress is confusing during startup

Mitigation:

- explicit snapshot progress events
- F1 progress visibility
- near-first ordering

## Definition of Done

This project is done when:

- native and web both run on `world_runtime`
- native threaded runtime is default
- browser `/?perf` uses worker-backed runtime
- render is chunk/layer patch-driven
- snapshot-driven broad dirty rebuilds are gone from the hot path
- telemetry is automatic, persistent, and useful for LLM copy/paste
- layer toggles reduce runtime work
- startup and resync are explicit, progressive, and measurable
- release path inherits the validated perf architecture
