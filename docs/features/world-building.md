# World building

The shared builder creates serializable world definitions. The browser host and
headless runner use the same simulation. See
[world and terrain](world-and-terrain.md) for the built-in terrain recipes.

## Purpose

Construct small worlds for tests, compose custom terrain and structures, and try
different world generators through one shared construction API. Finish world
setup before the session starts so tests can declare the entities they need.

World setup previously crossed `app.js` and `session.js`. Tests removed an
implicit corner NPC after boot. Recipes now declare terrain, generation, spawn
points, shops, and NPCs before play. Tests request the NPC only when they need
it.

## Construction rules

### Recipes and behavior

A reusable world recipe owns terrain, structure placement, entities, player
spawn points, and the optional generator. The application and tests use the same
world construction API.

The world definition is serializable. JavaScript builders can produce that
definition, and both browser startup and a headless runner can load it.
Generators and behaviors use registered names and serializable parameters.
Functions are resolved by the runtime rather than embedded in the definition.

NPC behavior stays simple in this pass: an NPC stands still or follows a
configured patrol route. A placed shopkeeper provides the basic shop
interaction. Its design can grow in a later NPC pass.

### Structures

Structures use local coordinates and are placed at an origin. They can include
entities and player spawn points. A recipe can also configure entities and spawn
points outside structures, including repeated placements.

A placement can omit entities or spawn points with `entities: false` or
`spawns: false`. Its `id` prefixes entity IDs so repeated structures can create
distinct entities. Patrol waypoints are relative to each entity.

### Construction stages

Terrain generation deterministically creates chunk terrain, including the
terrain edits contributed by structures.

Session setup creates initial entities and registers player spawn points once.
Unloading and regenerating a chunk must not duplicate its NPCs.

### Player spawning

This pass supports spawn selection for the host and joining players. Structures
can contribute spawn points, and recipes can configure them directly. Timed NPC
spawning is deferred.

Choose player spawn points in declaration order, cycling back to the start. Do
not skip a point because another entity occupies it or its terrain is solid.
Players may spawn on top of other entities or inside solid terrain in this pass.
Contested or blocked spawn points must not prevent joining the world. Repeated
coordinates remain valid.

### Composition order

Create base terrain first. Apply structure placements and explicit terrain edits
in declaration order. A later write to the same tile wins.

Chunk regeneration follows the same order, then applies gameplay edits last.
Those edits preserve changes made by mining and placing during the session.
Regeneration only restores terrain. Initial entities remain part of session
setup.

Duplicate entity IDs are validation errors. Player spawn points may repeat
intentionally.

### World boundaries

A recipe explicitly chooses a fixed boundary or generated expansion. Small test
recipes default to a fixed boundary with solid terrain outside. Exploration
recipes supply a seeded generator for terrain beyond the authored area.

### Shared simulation runner

This pass includes a simulation runner that constructs a world, applies player
actions, and advances ticks without a browser. It owns authoritative world
state, NPC behavior, player spawning, and tick advancement.

Browser input, rendering, networking, and wall-clock pacing sit around the
runner. A future server process can use the same runner. Implementing that
hosted process is deferred.

Headless tests can advance thousands of simulation ticks without waiting for
real time. Faster execution preserves the normal fixed tick duration and the
rules evaluated each tick. It does not promise a particular throughput.

`shared/simulation.js` owns local and guest movement and stamina, mining, NPC
behavior, terrain generation, and unloading. `client/loop.js` supplies local
input and camera interest and paces the ticks. `client/network-host.js` queues
remote actions and publishes the resulting state.

Simulation time controls world lifetimes. The existing chunk unloader accepts a
time argument, so the runner can supply time derived from its tick count. Camera
interest in terrain becomes an explicit input from the browser adapter.
Visibility used to validate actions must be available without a render frame.

### Action timing and order

The runner queues player actions for the next tick boundary and applies them in
arrival order. Headless tests control submission order and tick advancement to
reproduce the same sequence. Contested actions, such as two pickups of one
stack, keep that order.

Requests previously executed as soon as their messages arrived. An authoritative
response can wait up to one simulation tick. Each tick advances world time,
applies the queued actions in order, steps NPCs and player movement, updates
stamina, advances mining, generates terrain, and records footsteps. Chunk
unloading runs every 20 ticks. Action callbacks can queue work for the following
tick. Sight is recomputed when validating mining and placing.

## Builder API

`worldBuilder()` starts with solid terrain in a 16×16 area across levels 0–7. It
adds no NPCs, shops, or generator. Bounds and paint boxes are inclusive. For a
fixed world, terrain outside its bounds stays solid and cannot be mined.

```js
import { worldBuilder } from "../../src/shared/world-builder.js";
import { createSimulation } from "../../src/shared/simulation.js";
import { OPEN } from "../../src/shared/terrain.js";

const definition = worldBuilder()
  .fill({ minX: 1, maxX: 7, minY: 1, maxY: 7, minZ: 1, maxZ: 1 }, OPEN)
  .spawn({ x: 4, y: 4, z: 1 })
  .tile({ x: 5, y: 4, z: 1 }, 2)
  .definition();

const simulation = createSimulation(JSON.parse(JSON.stringify(definition)));
simulation.join("self");
simulation.enqueue("self", { type: "mine", x: 5, y: 4, z: 1 });
simulation.advanceTicks(21);
```

| Method                                      | Contribution                                                |
| ------------------------------------------- | ----------------------------------------------------------- |
| `bounds(box)`, `base(material)`             | Initially loaded area and base material                     |
| `seed(number)`, `generator(id, params)`     | Seeded expansion through a registered generator             |
| `fill(box, material)`, `tile(at, material)` | Ordered terrain paint operations                            |
| `place(structure, origin, options)`         | Translated terrain, entities, and spawn points              |
| `entity(definition)`                        | Initial entity, inventory, held item, and optional behavior |
| `spawn(at)`                                 | Player spawn point                                          |
| `drop(at, kind, count)`                     | Initial dropped stack                                       |
| `pin(cx, cy)`, `unloadGrace(ticks)`         | Chunk lifetime configuration                                |
| `definition()`                              | Independent serializable definition                         |
| `build()`                                   | Initial world, frozen definition, and spawn selector        |

A structure contains local `paints`, `entities`, and `spawns`. An entity has an
`id` and `at`, with optional `name`, `inventory`, `held`, and `behavior`.
`role: "shop"` contributes a stationary shop tile with the basic shop behavior.
Shops travel in authoritative snapshots so a guest uses the same locations.
Protocol version 5 carries shop tiles, NPC flags, and fixed-world bounds. An
older peer must reload or join the matching historical build. Other initial
entities are NPCs. A joining participant is a player.

Definitions carry `version: 1`. Loading checks JSON values, coordinates,
materials, entity IDs, and generator names. A simulation also resolves behavior
names. The loaded definition is frozen and isolated from the caller.

`registerWorldGenerator(id, factory)` adds a generator factory that takes the
seed and parameters and returns a chunk function `(cx, cy) => Uint8Array`.
Register it in a module imported before world construction. The built-in names
are `caves` and `solid`. The builder copies chunk output before applying paint
operations, so overlays do not mutate a generator's cached data.

`registerWorldBehavior(id, factory)` adds a behavior that takes the world,
entity ID, and parameters and returns a tick function. Built-in behaviors are
`still` and `patrol`. Patrol parameters include relative `waypoints`,
`pauseEvery`, and `pauseTicks`.

Pinning is explicit. The production room recipe pins its four initial chunks.
Unpinned generated chunks replay their structural terrain and gameplay edits
when reloaded. Fixed worlds have no generator and do not unload.

## Running without a browser

```sh
deno task simulate --recipe=test --ticks=10000
deno task simulate --recipe=room --ticks=10000
deno task simulate path/to/world.json --ticks=10000
```

The command reports tick count, elapsed time, throughput, loaded chunks,
players, inventories, and drops. It runs the simulation without real-time
pacing. Throughput depends on the world and active work, including mining sight
checks and generation. An idle world benchmark does not measure those costs.

The programmatic runner exposes `join`, `leave`, `enqueue`, `input`, `interest`,
`state`, `sees`, and `advanceTicks`. Rendering and network transport belong to
adapters. A browser entrypoint can pass a definition to
`startApp({ worldDefinition: definition })`.

## Browser test driver

`tests/e2e/world.ts` owns scripted setup and observations.
`startWorld(page,
definition)` supplies a definition before navigation.
`openWorld(page, url,
options)` selects an explicit built-in recipe, with
`npc: true` only for tests that need an NPC. Reloads replay the latest supplied
definition.

`readWorld(page, callback, argument)` runs typed observations or fixture
commands through `client/test-driver.js`. Shared helpers give items, drop
stacks, write a tile, and place a player. The driver's `edit` applies fixture
patches through shared terrain and inventory rules. Actual interactions still
use browser input.

`app.js` constructs the inspection API and injects it into the driver with a
small fixture service contract: access the current world, identify a guest,
invalidate visibility, and publish changes. The driver imports shared rules and
has no dependency on the client context or manual harness modules. The test
helper derives its types from the injected API.

Every scripted `__od` read has migrated to this driver. The manual `__od` tool
remains available for agents and human testers. Unit fixture constructors also
use the builder, including the retained authored and spawn-room helper APIs.
`tests/lint/world_setup_test.ts` prevents new direct `__od` reads and bare unit
world fixture imports.

## Implementation constraints

Keep shared and browser code in plain JavaScript with JSDoc types. Browser files
run without a build step. Use the existing terrain API so chunk caches, terrain
changes, and edit persistence stay consistent.

The host constructs and simulates the world. Guests receive authoritative
terrain and entity state. Browser tests keep tick waits and repeat changed specs
five times, as described in [testing and evidence](testing-and-evidence.md).
