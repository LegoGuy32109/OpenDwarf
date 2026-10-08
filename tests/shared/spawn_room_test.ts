import { assert, assertEquals } from "@std/assert";
import {
  createSpawnRoomWorld,
  DOORWAY,
  layoutFromParams,
  NPC_ORIGIN,
  ROOM,
  ROOM_Z,
  roomSpawnTile,
  SHELL,
  SHOPKEEPER_TILE,
  STAIRS,
  TUNNEL,
  TUNNEL_ORES,
} from "../../src/shared/spawn-room.js";
import { hasChunk, readTile, setChunk } from "../../src/shared/terrain.js";
import {
  generateChunkData,
  seedFromText,
  WORLD_SEED,
} from "../../src/shared/generation.js";
import { GOLD_ORE } from "../../src/shared/materials.js";
import { createCornerNpc } from "../../src/shared/npc.js";
import {
  addPlayer,
  advanceTicks,
  isSolid,
  startMove,
} from "../../src/shared/world.js";

/** Walk one tile step at a time and return the final position. */
function walk(
  world: ReturnType<typeof createSpawnRoomWorld>,
  id: string,
  steps: Array<[number, number]>,
) {
  let sequence = 1;
  for (const [dx, dy] of steps) {
    const result = startMove(world, id, dx, dy, sequence++);
    assert(result.ok, `step ${dx},${dy} failed: ${result.reason}`);
    advanceTicks(world, 20);
  }
  const player = world.players[id];
  return { x: player.x, y: player.y, z: player.z };
}

Deno.test("spawn room is 9 by 7, enclosed, with one doorway into stone", () => {
  const world = createSpawnRoomWorld();
  assertEquals(ROOM.maxX - ROOM.minX + 1, 9);
  assertEquals(ROOM.maxY - ROOM.minY + 1, 7);
  // Inside the shell only the carved spaces are open; generated caves stay out.
  const carved = new Set<string>();
  const add = (x: number, y: number, z: number) => carved.add(`${x},${y},${z}`);
  for (let y = ROOM.minY; y <= ROOM.maxY; y++) {
    for (let x = ROOM.minX; x <= ROOM.maxX; x++) add(x, y, ROOM_Z);
  }
  add(DOORWAY.x, DOORWAY.y, DOORWAY.z);
  for (const { x, y, z } of STAIRS) add(x, y, z);
  add(STAIRS[1].x, STAIRS[1].y, STAIRS[1].z + 1);
  for (let x = TUNNEL.minX; x <= SHELL.maxX; x++) add(x, TUNNEL.y, TUNNEL.z);
  for (let z = SHELL.minZ; z <= SHELL.maxZ; z++) {
    for (let y = SHELL.minY; y <= SHELL.maxY; y++) {
      for (let x = SHELL.minX; x <= SHELL.maxX; x++) {
        assertEquals(
          !isSolid(world, x, y, z),
          carved.has(`${x},${y},${z}`),
          `${x},${y},${z}`,
        );
      }
    }
  }
  assertEquals(isSolid(world, DOORWAY.x, DOORWAY.y, ROOM_Z), false);
  assertEquals(isSolid(world, DOORWAY.x, DOORWAY.y + 1, ROOM_Z), true);
  assertEquals(isSolid(world, DOORWAY.x, DOORWAY.y + 1, ROOM_Z - 1), true);
  assertEquals(isSolid(world, 16, 15, ROOM_Z + 1), true, "ceiling");
  assertEquals(isSolid(world, 16, 15, ROOM_Z - 1), true, "floor");
  assertEquals(isSolid(world, ROOM.minX - 1, 15, ROOM_Z), true);
  assertEquals(world.changes?.size ?? 0, 0);
});

Deno.test("another seed changes the caves but keeps the room whole", () => {
  const world = createSpawnRoomWorld(seedFromText("another world"));
  assertEquals(isSolid(world, 16, 15, ROOM_Z), false);
  assertEquals(isSolid(world, 16, 15, ROOM_Z + 1), true);
  assertEquals(isSolid(world, ROOM.minX - 1, 15, ROOM_Z), true);
  assertEquals(isSolid(world, DOORWAY.x, DOORWAY.y + 1, ROOM_Z), true);
});

/** Count the tiles a player can walk to from the spawn tile with the move rules, in a square of chunks. */
function walkable(world: ReturnType<typeof createSpawnRoomWorld>, r: number) {
  for (let cy = -r; cy <= r + 1; cy++) {
    for (let cx = -r; cx <= r + 1; cx++) {
      if (!hasChunk(world, cx, cy)) {
        setChunk(world, cx, cy, generateChunkData(WORLD_SEED, cx, cy));
      }
    }
  }
  const min = -r * 16;
  const max = (r + 2) * 16 - 1;
  const start = roomSpawnTile(0);
  const seen = new Set([`${start.x},${start.y},${start.z}`]);
  const queue = [start];
  const levels = new Set<number>();
  while (queue.length) {
    const { x, y, z } = queue.pop()!;
    levels.add(z);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < min || ny < min || nx > max || ny > max) continue;
      let nz = -1;
      if (!isSolid(world, nx, ny, z) && isSolid(world, nx, ny, z - 1)) nz = z;
      else if (
        z < 7 && isSolid(world, nx, ny, z) && !isSolid(world, nx, ny, z + 1) &&
        !isSolid(world, x, y, z + 1)
      ) nz = z + 1;
      else if (
        !isSolid(world, nx, ny, z) && !isSolid(world, nx, ny, z - 1) &&
        isSolid(world, nx, ny, z - 2)
      ) nz = z - 1;
      const key = `${nx},${ny},${nz}`;
      if (nz < 0 || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny, z: nz });
    }
  }
  return { tiles: seen.size, levels };
}

Deno.test("the tunnel opens into a cave network that reaches every level", () => {
  const { tiles, levels } = walkable(createSpawnRoomWorld(), 3);
  // Thousands of tiles within three chunks of spawn, from z 0 to the top.
  assert(tiles > 5000, `only ${tiles} tiles are walkable from spawn`);
  assertEquals([...levels].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
});

Deno.test("every spawn tile and the shopkeeper tile are open room floor", () => {
  const world = createSpawnRoomWorld();
  for (let ordinal = 0; ordinal < 12; ordinal++) {
    const tile = roomSpawnTile(ordinal);
    assertEquals(tile.z, ROOM_Z);
    assert(tile.x >= ROOM.minX && tile.x <= ROOM.maxX);
    assert(tile.y >= ROOM.minY && tile.y <= ROOM.maxY);
    assertEquals(isSolid(world, tile.x, tile.y, tile.z), false);
    assertEquals(isSolid(world, tile.x, tile.y, tile.z - 1), true);
    assert(tile.x !== SHOPKEEPER_TILE.x || tile.y !== SHOPKEEPER_TILE.y);
  }
  assertEquals(
    isSolid(world, SHOPKEEPER_TILE.x, SHOPKEEPER_TILE.y, ROOM_Z),
    false,
  );
});

Deno.test("a player walks out the doorway, and down the stairs into the tunnel", () => {
  const world = createSpawnRoomWorld();
  const spawn = roomSpawnTile(0);
  addPlayer(world, "self", spawn);
  // To the doorway: straight south from the spawn tile, then out.
  const south = Array(DOORWAY.y - spawn.y).fill([0, 1]) as Array<
    [number, number]
  >;
  assertEquals(walk(world, "self", south), DOORWAY);
  // Blocked beyond the doorway: it opens into solid stone.
  assertEquals(startMove(world, "self", 0, 1, 99).ok, false);
  // Back up to the room, across to the stairs, down and along the tunnel.
  const north = Array(DOORWAY.y - STAIRS[0].y).fill([0, -1]) as Array<
    [number, number]
  >;
  assertEquals(walk(world, "self", north), {
    x: DOORWAY.x,
    y: STAIRS[0].y,
    z: ROOM_Z,
  });
  const east = Array(STAIRS[0].x - DOORWAY.x).fill([1, 0]) as Array<
    [number, number]
  >;
  assertEquals(walk(world, "self", east), { ...STAIRS[0], z: ROOM_Z - 1 });
  assertEquals(walk(world, "self", [[1, 0]]), STAIRS[1]);
  const tunnel = Array(TUNNEL.maxX - STAIRS[1].x).fill([1, 0]) as Array<
    [number, number]
  >;
  assertEquals(walk(world, "self", tunnel), {
    x: TUNNEL.maxX,
    y: TUNNEL.y,
    z: TUNNEL.z,
  });
  // And back up into the room.
  const back = Array(TUNNEL.maxX - STAIRS[0].x).fill([-1, 0]) as Array<
    [number, number]
  >;
  assertEquals(walk(world, "self", back), { ...STAIRS[0], z: ROOM_Z - 1 });
  assertEquals(walk(world, "self", [[-1, 0]]).z, ROOM_Z);
});

Deno.test("several players may spawn on one tile", () => {
  const world = createSpawnRoomWorld();
  const spawn = roomSpawnTile(0);
  addPlayer(world, "a", spawn);
  addPlayer(world, "b", spawn);
  assertEquals(
    [world.players.a.x, world.players.a.y],
    [world.players.b.x, world.players.b.y],
  );
});

Deno.test("the corner NPC walks its square inside the room", () => {
  const world = createSpawnRoomWorld();
  const tick = createCornerNpc(world, NPC_ORIGIN);
  const npc = world.players["npc-corner"];
  let moved = false;
  for (let i = 0; i < 400; i++) {
    tick();
    advanceTicks(world);
    assert(npc.x >= ROOM.minX && npc.x <= ROOM.maxX, `x ${npc.x}`);
    assert(npc.y >= ROOM.minY && npc.y <= ROOM.maxY, `y ${npc.y}`);
    assertEquals(npc.z, ROOM_Z);
    moved ||= npc.x !== NPC_ORIGIN.x || npc.y !== NPC_ORIGIN.y;
  }
  assert(moved);
});

Deno.test("harness pages keep the test layout unless they ask for the room", () => {
  const layout = (query: string) =>
    layoutFromParams(new URLSearchParams(query));
  assertEquals(layout(""), "room");
  assertEquals(layout("world=32"), "room");
  assertEquals(layout("harness=1"), "test");
  assertEquals(layout("harness=1&layout=room"), "room");
  assertEquals(layout("layout=test"), "test");
});

Deno.test("the tunnel walls hold coal and iron, with gold near the end", () => {
  const world = createSpawnRoomWorld();
  for (const { x, y, z, material } of TUNNEL_ORES) {
    assertEquals(readTile(world, x, y, z), material);
  }
  assert(TUNNEL_ORES.some((ore) => ore.material === GOLD_ORE));
  // The tunnel itself stays open and the ore never sits in the room.
  for (let x = TUNNEL.minX; x <= TUNNEL.maxX; x++) {
    assert(!isSolid(world, x, TUNNEL.y, TUNNEL.z));
  }
  assert(TUNNEL_ORES.every((ore) => ore.x > ROOM.maxX));
});
