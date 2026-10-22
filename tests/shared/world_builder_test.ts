import { interactPreview } from "../../src/shared/interact-preview.js";
import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  buildWorld,
  registerWorldGenerator,
  type Structure,
  worldBuilder,
} from "../../src/shared/world-builder.js";
import {
  createSimulation,
  registerWorldBehavior,
} from "../../src/shared/simulation.js";
import { authoredRecipe, roomRecipe } from "../../src/shared/world-recipes.js";
import {
  createChunkData,
  ensureChunk,
  OPEN,
  readTile,
  STONE,
  unloadChunk,
  writeTile,
} from "../../src/shared/terrain.js";
import { dropItem, droppedAt, inventoryOf } from "../../src/shared/items.js";
import { miningActions } from "../../src/shared/mining.js";
import { drainSounds } from "../../src/shared/sound.js";
import { decodeState, encodeWorld } from "../../src/shared/wire.js";

function small() {
  return worldBuilder().base(STONE)
    .fill({ minX: 1, maxX: 8, minY: 1, maxY: 8, minZ: 1, maxZ: 1 }, OPEN)
    .spawn({ x: 4, y: 4, z: 1 });
}
Deno.test("a serialized definition replays terrain, entities, inventory, and repeated spawn points", () => {
  const definition = small().entity({
    id: "observer",
    at: { x: 2, y: 2, z: 1 },
    behavior: { id: "still" },
    inventory: [{ kind: "coal", count: 2 }],
    held: "coal",
  })
    .drop({ x: 3, y: 3, z: 1 }, "diamond", 2).spawn({ x: 4, y: 4, z: 1 })
    .definition();
  const a = createSimulation(definition),
    b = createSimulation(JSON.parse(JSON.stringify(definition)));
  assertEquals(a.world.chunks, b.world.chunks);
  assertEquals(a.world.players, b.world.players);
  assertEquals(inventoryOf(a.world.players.observer), [{
    kind: "pickaxe",
    count: 1,
  }, { kind: "coal", count: 2 }]);
  assertEquals(droppedAt(a.world, { x: 3, y: 3, z: 1 }), [{
    kind: "diamond",
    count: 2,
  }]);
  a.join("host");
  a.join("guest");
  a.join("third");
  assertEquals(
    Object.values(a.world.players).filter((p) => !p.npc).map(
      (p) => [p.x, p.y, p.z],
    ),
    [[4, 4, 1], [4, 4, 1], [4, 4, 1]],
  );
});
Deno.test("spawning remains permissive inside solid terrain and occupied tiles", () => {
  const sim = createSimulation(
    worldBuilder().spawn({ x: 5, y: 5, z: 1 }).definition(),
  );
  assertEquals(readTile(sim.world, 5, 5, 1), STONE);
  assertEquals(sim.join("host").x, 5);
  assertEquals(sim.join("guest").x, 5);
});
Deno.test("structure placements translate terrain, entities, and spawn points with explicit overrides", () => {
  const room: Structure = {
    paints: [{
      bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 0 },
      material: OPEN,
    }],
    entities: [{
      id: "shop",
      name: "Ulgar",
      role: "trader",
      at: { x: 1, y: 1, z: 0 },
    }],
    spawns: [{ x: 2, y: 2, z: 0 }],
  };
  const b = worldBuilder().place(room, { x: 2, y: 2, z: 1 }, { id: "first" })
    .place(room, { x: 8, y: 8, z: 1 }, {
      id: "second",
      entities: false,
      spawns: false,
    }).tile({ x: 3, y: 3, z: 1 }, STONE);
  const built = b.build();
  assertEquals(readTile(built.world, 2, 2, 1), OPEN);
  assertEquals(readTile(built.world, 3, 3, 1), STONE);
  assertEquals(readTile(built.world, 8, 8, 1), OPEN);
  assertEquals(built.world.players["first:shop"].role, "trader");
  assertEquals(built.definition.spawns, [{ x: 4, y: 4, z: 1 }]);
  assertEquals(built.definition.entities[0].id, "first:shop");
});
Deno.test("declaration order survives chunk unload and regeneration, followed by gameplay edits", () => {
  const b = worldBuilder().generator("solid").fill({
    minX: 16,
    maxX: 20,
    minY: 1,
    maxY: 4,
    minZ: 1,
    maxZ: 1,
  }, OPEN).tile({ x: 18, y: 2, z: 1 }, STONE);
  const { world } = b.build();
  ensureChunk(world, 1, 0);
  assertEquals(readTile(world, 17, 2, 1), OPEN);
  assertEquals(readTile(world, 18, 2, 1), STONE);
  writeTile(world, 18, 2, 1, OPEN);
  writeTile(world, 17, 2, 1, STONE);
  assert(unloadChunk(world, 1, 0));
  ensureChunk(world, 1, 0);
  assertEquals(readTile(world, 18, 2, 1), OPEN);
  assertEquals(readTile(world, 17, 2, 1), STONE);
});
Deno.test("regenerating terrain does not recreate entities and explicit pinned chunks stay loaded", () => {
  const sim = createSimulation(
    small().generator("solid").pin(0, 0).entity({
      id: "npc",
      at: { x: 2, y: 2, z: 1 },
    }).definition(),
  );
  assert(!unloadChunk(sim.world, 0, 0));
  ensureChunk(sim.world, 1, 0);
  assert(unloadChunk(sim.world, 1, 0));
  ensureChunk(sim.world, 1, 0);
  assertEquals(Object.keys(sim.world.players), ["npc"]);
});
Deno.test("fixed worlds do not expand and loaded chunk padding is solid", () => {
  const b = worldBuilder().base(OPEN).bounds({
    minX: 2,
    maxX: 5,
    minY: 2,
    maxY: 5,
    minZ: 1,
    maxZ: 1,
  }).build();
  assertEquals(b.world.generateChunk, undefined);
  assertEquals(readTile(b.world, 2, 2, 1), OPEN);
  assertEquals(readTile(b.world, 1, 2, 1), STONE);
  assertEquals(readTile(b.world, 2, 2, 0), STONE);
  assertEquals(readTile(b.world, 16, 2, 1), STONE);
});
Deno.test("definitions reject duplicate IDs, invalid materials, unsupported components, and non-JSON values", () => {
  assertThrows(() =>
    small().entity({ id: "same", at: { x: 2, y: 2, z: 1 } }).entity({
      id: "same",
      at: { x: 3, y: 3, z: 1 },
    }).definition()
  );
  assertThrows(() => small().base(200).definition());
  assertThrows(() => small().generator("unknown").definition());
  assertThrows(() => small().generator("solid", { value: NaN }).definition());
  assertThrows(() =>
    small().generator("solid", { value: () => 1 }).definition()
  );
  assertThrows(() =>
    createSimulation(
      small().entity({
        id: "npc",
        at: { x: 2, y: 2, z: 1 },
        behavior: { id: "unknown" },
      }).definition(),
    )
  );
  assertThrows(() =>
    small().entity({ id: "__proto__", at: { x: 2, y: 2, z: 1 } }).definition()
  );
});
Deno.test("alternative registered generators and behaviors run headlessly", () => {
  registerWorldGenerator(
    "unit-flat",
    (_seed, params) => () => createChunkData(Number(params.material)),
  );
  registerWorldBehavior("unit-mark", (world, id) => () => {
    world.players[id].name = "marked";
  });
  const sim = createSimulation(
    worldBuilder().generator("unit-flat", { material: OPEN }).entity({
      id: "npc",
      at: { x: 2, y: 2, z: 1 },
      behavior: { id: "unit-mark" },
    }).definition(),
  );
  sim.advanceTicks();
  assertEquals(sim.world.players.npc.name, "marked");
  ensureChunk(sim.world, -1, 0);
  assertEquals(readTile(sim.world, -1, 2, 1), OPEN);
});
Deno.test("player actions apply next tick in submission order, including contested pickups", () => {
  const sim = createSimulation(
    small().spawn({ x: 5, y: 4, z: 1 }).definition(),
  );
  sim.join("host");
  sim.join("guest");
  dropItem(sim.world, { x: 4, y: 4, z: 1 }, "diamond", 2);
  const results: Record<string, unknown>[] = [];
  for (const id of ["guest", "host"]) {
    sim.enqueue(
      id,
      { type: "pickup", x: 4, y: 4, z: 1, kind: "diamond" },
      (r) => results.push(r),
    );
  }
  assertEquals(results, []);
  sim.advanceTicks();
  assertEquals(results.map((r) => r.ok), [true, false]);
  assertEquals(
    inventoryOf(sim.world.players.guest).find((s) => s.kind === "diamond")
      ?.count,
    2,
  );
  assertEquals(inventoryOf(sim.world.players.host), [{
    kind: "pickaxe",
    count: 1,
  }]);
});
Deno.test("actions enqueued by a result callback run on the following tick", () => {
  const sim = createSimulation(small().definition());
  sim.join("host");
  sim.enqueue(
    "host",
    { type: "nick", name: "First" },
    () => sim.enqueue("host", { type: "nick", name: "Second" }),
  );
  sim.advanceTicks();
  assertEquals(sim.world.players.host.name, "First");
  sim.advanceTicks();
  assertEquals(sim.world.players.host.name, "Second");
});
Deno.test("headless mining, pickup, holding, and placing use one authoritative runner", () => {
  const sim = createSimulation(
    small().tile({ x: 5, y: 4, z: 1 }, STONE).definition(),
  );
  sim.join("host");
  sim.enqueue("host", { type: "mine", x: 5, y: 4, z: 1 });
  sim.advanceTicks();
  assertEquals(miningActions(sim.world).size, 1);
  sim.advanceTicks(20);
  assertEquals(readTile(sim.world, 5, 4, 1), OPEN);
  sim.enqueue("host", { type: "pickup", x: 5, y: 4, z: 1, kind: "stone" });
  sim.enqueue("host", { type: "hold", kind: "stone" });
  sim.enqueue("host", { type: "place", x: 5, y: 4, z: 1 });
  sim.advanceTicks();
  assertEquals(readTile(sim.world, 5, 4, 1), STONE);
  assertEquals(inventoryOf(sim.world.players.host), [{
    kind: "pickaxe",
    count: 1,
  }]);
});
Deno.test("headless patrols, movement, stamina, and lifetimes progress entirely by ticks", () => {
  const sim = createSimulation(
    small().entity({
      id: "walker",
      at: { x: 2, y: 2, z: 1 },
      behavior: {
        id: "patrol",
        params: { waypoints: [{ x: 1, y: 0 }, { x: 0, y: 0 }] },
      },
    }).definition(),
  );
  sim.join("host");
  sim.enqueue("host", { type: "input", dx: 1, dy: 0, sprint: true });
  sim.advanceTicks(10);
  assert(sim.world.players.host.x > 4);
  assert(sim.world.players.walker.x > 2);
  assert(sim.state("host").stamina.value < 1);
  sim.input("host", { x: 0, y: 0 });
  sim.advanceTicks(10000);
  assertEquals(sim.world.tick, 10010);
  assertEquals(sim.state("host").stamina.value, 1);
  drainSounds(sim.world);
});
Deno.test("built-in recipes preserve terrain and build Ulgar as an NPC", () => {
  const room = buildWorld(roomRecipe());
  const ulgar = room.world.players["npc-ulgar"];
  assertEquals(
    { name: ulgar.name, npc: ulgar.npc, role: ulgar.role, free: ulgar.free },
    { name: "Ulgar", npc: true, role: "trader", free: true },
  );
  assertEquals({ x: ulgar.x, y: ulgar.y, z: ulgar.z }, { x: 16, y: 12, z: 4 });
  assertEquals(room.world.players["npc-corner"].role, undefined);
  assertEquals(readTile(room.world, 16, 15, 4), OPEN);
  const test = buildWorld(authoredRecipe());
  assertEquals(Object.keys(test.world.players), []);
  assertEquals(readTile(test.world, 2, 1, 0), STONE);
  assertEquals(
    encodeWorld(room.world).players["npc-ulgar"].role,
    "trader",
  );
});
Deno.test("Ulgar blocks movement: a move onto its tile is refused as occupied", () => {
  const sim = createSimulation(roomRecipe(undefined, { npc: false }));
  const ulgar = sim.world.players["npc-ulgar"];
  const guest = sim.join("guest");
  Object.assign(sim.world.players.guest, {
    x: ulgar.x,
    y: ulgar.y + 1,
    z: ulgar.z,
  });
  assertEquals(guest.z, ulgar.z);
  sim.enqueue("guest", { type: "move", dx: 0, dy: -1, sequence: 1 });
  sim.advanceTicks(2);
  assertEquals(sim.world.players.guest.y, ulgar.y + 1);
  assertEquals(sim.world.players.guest.move, null);
  sim.input("guest", { x: 0, y: -1 });
  sim.advanceTicks(40);
  assert(sim.world.players.guest.y > ulgar.y, "free movement stops at Ulgar");
  assertEquals({ x: ulgar.x, y: ulgar.y }, { x: 16, y: 12 });
});
Deno.test("a definition with an unknown entity role is refused when it loads", () => {
  assertThrows(
    () =>
      createSimulation(
        small().entity({
          id: "npc",
          at: { x: 2, y: 2, z: 1 },
          role: "king" as "trader",
        }).definition(),
      ),
    Error,
    "Unknown entity role",
  );
  const trader = small().entity({
    id: "npc",
    at: { x: 2, y: 2, z: 1 },
    role: "trader",
  }).definition();
  assertEquals(createSimulation(trader).world.players.npc.role, "trader");
});

Deno.test("an entity with an unknown role is refused atomically by the wire", () => {
  const sim = createSimulation(small().definition());
  sim.join("host");
  const packet = {
    type: "state",
    attempt: "test",
    viewRevision: 0,
    sightRevision: 0,
    mode: "master",
    playerId: "host",
    acknowledgedSequence: 0,
    world: encodeWorld(sim.world),
    reveal: {},
    visibility: null,
    chat: [],
  };
  assert(decodeState(packet));
  assertEquals(
    decodeState({
      ...packet,
      world: {
        ...packet.world,
        players: {
          ...packet.world.players,
          host: { ...packet.world.players.host, role: "king" },
        },
      },
    }),
    null,
  );
});

Deno.test("fixed boundaries stay solid even when a paint crosses them and mining is refused outside", () => {
  const b = worldBuilder().bounds({
    minX: 2,
    maxX: 5,
    minY: 2,
    maxY: 5,
    minZ: 1,
    maxZ: 1,
  })
    .fill({ minX: 0, maxX: 8, minY: 0, maxY: 8, minZ: 0, maxZ: 2 }, OPEN).spawn(
      { x: 2, y: 3, z: 1 },
    );
  const sim = createSimulation(b.definition());
  sim.join("host");
  assertEquals(readTile(sim.world, 1, 3, 1), STONE);
  let result: Record<string, unknown> | undefined;
  sim.enqueue("host", { type: "mine", x: 1, y: 3, z: 1 }, (r) => result = r);
  sim.advanceTicks();
  assertEquals(result, { ok: false, reason: "out of reach" });
  assertEquals(miningActions(sim.world).size, 0);
  assertEquals(
    interactPreview(
      sim.world,
      sim.world.players.host,
      { x: 1, y: 3, z: 1 },
      () => true,
    ),
    null,
  );
});
Deno.test("definitions are frozen and isolated from caller mutation during replay", () => {
  const original = small().generator("solid").definition();
  const sim = createSimulation(original);
  original.paints.length = 0;
  assertThrows(() =>
    sim.definition.paints.push({ bounds: original.bounds, material: OPEN })
  );
  ensureChunk(sim.world, 1, 0);
  assertEquals(readTile(sim.world, 4, 4, 1), OPEN);
});
Deno.test("chunk lifetime follows simulation ticks without a wall clock", () => {
  const sim = createSimulation(
    small().generator("solid").unloadGrace(20).definition(),
  );
  sim.join("host");
  ensureChunk(sim.world, 5, 5);
  sim.advanceTicks(20);
  assert(sim.world.chunks.has("5,5"));
  sim.advanceTicks(20);
  assert(!sim.world.chunks.has("5,5"));
});
Deno.test("a configured patrol also supports legacy tile movement without a browser", () => {
  const sim = createSimulation(
    small().entity({
      id: "walker",
      free: false,
      at: { x: 2, y: 2, z: 1 },
      behavior: {
        id: "patrol",
        params: {
          waypoints: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, {
            x: 0,
            y: 0,
          }],
        },
      },
    }).definition(),
  );
  sim.advanceTicks();
  assertEquals(sim.world.players.walker.move?.target, { x: 3, y: 2, z: 1 });
  sim.advanceTicks(12);
  assertEquals(sim.world.players.walker.x, 3);
});

Deno.test("fixed-world bounds are carried by snapshots and invalid bounds are rejected", () => {
  const sim = createSimulation(small().definition());
  sim.join("host");
  const packet = {
    type: "state",
    attempt: "bounds",
    viewRevision: 0,
    sightRevision: 0,
    mode: "master",
    playerId: "host",
    acknowledgedSequence: 0,
    world: encodeWorld(sim.world),
    reveal: {},
    visibility: null,
    chat: [],
  };
  assertEquals(decodeState(packet)?.world.limits, sim.definition.bounds);
  assertEquals(
    decodeState({
      ...packet,
      world: {
        ...packet.world,
        limits: { ...sim.definition.bounds, maxX: -1 },
      },
    }),
    null,
  );
});

Deno.test("participant IDs and queued actions cannot address object prototype properties", () => {
  const sim = createSimulation(small().definition());
  assertThrows(() => sim.join("__proto__"));
  let result: Record<string, unknown> | undefined;
  sim.enqueue(
    "__proto__",
    { type: "message", text: "invalid" },
    (r) => result = r,
  );
  sim.advanceTicks();
  assertEquals(result, { ok: false, reason: "unknown player" });
  assertEquals(Object.keys(sim.world.players), []);
  assertEquals(sim.join("toString").id, "toString");
  assert(Object.hasOwn(sim.world.players, "toString"));
});
