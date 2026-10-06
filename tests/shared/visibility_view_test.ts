import { assert, assertEquals } from "@std/assert";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { addPlayer, isSolid, startMove } from "../../src/shared/world.js";
import {
  boundaryOpacity,
  createVisibility,
  hasLineOfSight,
  tileKey,
} from "../../src/shared/visibility.js";

Deno.test("stationary entity keeps spatial opacity near sight corner", () => {
  const seen = new Set(["0,0,0", "1,0,0", "0,1,0"]);
  const visible = (x: number, y: number, z: number) =>
    seen.has(`${x},${y},${z}`);
  assertEquals(boundaryOpacity({ x: 0, y: 0, z: 0 }, visible), 1);
  assertEquals(boundaryOpacity({ x: 1.25, y: 0, z: 0 }, visible), 0.5);
  assert(boundaryOpacity({ x: 1.4, y: 0.4, z: 0 }, visible) < 0.3);
  assertEquals(boundaryOpacity({ x: 1.51, y: 0, z: 0 }, visible), 0);
});
import {
  entityView,
  viewMotionOpacity,
  viewMotionPosition,
} from "../../src/shared/view.js";
import {
  chunkCoord,
  chunkIndex,
  chunkKey,
  localCoord,
  OPEN,
  STONE,
  UNKNOWN,
  writeTile,
} from "../../src/shared/terrain.js";

/** Material a snapshot's chunks hold for a tile; UNKNOWN when the chunk was never sent. */
function seenMaterial(
  world: { chunks: Map<string, Uint8Array> },
  x: number,
  y: number,
  z: number,
) {
  const chunk = world.chunks.get(chunkKey(chunkCoord(x), chunkCoord(y)));
  return chunk?.[chunkIndex(localCoord(x), localCoord(y), z)] ?? UNKNOWN;
}

function snapshotChunks(chunks: Map<string, Uint8Array>) {
  return [...chunks].map(([key, data]) => [key, [...data]]);
}

Deno.test("same-level sight is reciprocal and every legal next tile is visible", () => {
  const world = createAuthoredWorld();
  const walkable = [];
  for (let z = 0; z <= 7; z++) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (!isSolid(world, x, y, z) && isSolid(world, x, y, z - 1)) {
          walkable.push({ x, y, z });
        }
      }
    }
  }
  for (let i = 0; i < walkable.length; i++) {
    for (let j = i + 1; j < walkable.length; j++) {
      const from = walkable[i];
      const to = walkable[j];
      if (from.z !== to.z) continue;
      assertEquals(
        hasLineOfSight(world, from, to),
        hasLineOfSight(world, to, from),
        `sight differs between ${JSON.stringify(from)} and ${
          JSON.stringify(to)
        }`,
      );
    }
  }
  for (const from of walkable) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const trial = createAuthoredWorld();
        addPlayer(trial, "self", from);
        const result = startMove(trial, "self", dx, dy, 1);
        if (result.ok && result.move && result.move.target.z === from.z) {
          assert(
            hasLineOfSight(world, from, result.move.target),
            `legal next tile is hidden: ${JSON.stringify(from)} to ${
              JSON.stringify(result.move.target)
            }`,
          );
        }
      }
    }
  }
});

Deno.test("guest snapshot excludes hidden entities and undiscovered terrain", () => {
  const world = createAuthoredWorld();
  addPlayer(world, "viewer", { x: 7, y: 8, z: 0 });
  addPlayer(world, "hidden", { x: 9, y: 8, z: 0 }).name = "secret";
  addPlayer(world, "seen", { x: 6, y: 8, z: 0 });
  const sight = createVisibility();
  const remembered = new Map();
  const snapshot = entityView(world, "viewer", sight, remembered);
  assertEquals(snapshot.world.players.hidden, undefined);
  assert(snapshot.world.players.viewer);
  assert(snapshot.world.players.seen);
  assertEquals(seenMaterial({ chunks: remembered }, 9, 8, 0), UNKNOWN);
  assertEquals(seenMaterial({ chunks: remembered }, 6, 8, 0), OPEN);
  assert(!JSON.stringify(snapshot).includes("secret"));
});

Deno.test("a crossing entity never sends a hidden move endpoint", () => {
  const world = createAuthoredWorld();
  addPlayer(world, "viewer", { x: 6, y: 6, z: 0 });
  const crossing = addPlayer(world, "crossing", { x: 9, y: 7, z: 0 });
  const sight = createVisibility();
  const remembered = new Map();
  crossing.move = {
    origin: { x: 9, y: 7, z: 0 },
    target: { x: 9, y: 8, z: 0 },
    startPosition: { x: 9, y: 7, z: 0 },
    startTick: 0,
    durationTicks: 10,
    sequence: 1,
  };
  world.tick = 2;
  const departing = entityView(world, "viewer", sight, remembered);
  assertEquals(departing.world.players.crossing?.move, null);
  assertEquals(departing.world.players.crossing?.y, 7);
  assert(!JSON.stringify(departing.world.players.crossing).includes('"y":8'));
  const exitMotion = departing.world.players.crossing?.viewMotion;
  assert(exitMotion);
  assertEquals(viewMotionOpacity(exitMotion, 2), 1);
  assert(viewMotionOpacity(exitMotion, 5) > 0);
  assert(viewMotionOpacity(exitMotion, 5) < 1);
  assert(viewMotionPosition(exitMotion, 5).y > 7);
  assert(viewMotionPosition(exitMotion, 5).y < 7.5);

  world.tick = 8;
  const hidden = entityView(world, "viewer", sight, remembered);
  assertEquals(hidden.world.players.crossing, undefined);

  crossing.move = {
    ...crossing.move,
    origin: { x: 9, y: 8, z: 0 },
    target: { x: 9, y: 7, z: 0 },
    startPosition: { x: 9, y: 8, z: 0 },
  };
  world.tick = 6;
  const arriving = entityView(world, "viewer", sight, remembered);
  assertEquals(arriving.world.players.crossing?.move, null);
  assertEquals(arriving.world.players.crossing?.y, 7);
  assert(!JSON.stringify(arriving.world.players.crossing).includes('"y":8'));
  const entryMotion = arriving.world.players.crossing?.viewMotion;
  assert(entryMotion);
  assert(viewMotionOpacity(entryMotion, 6) > 0);
  assert(viewMotionOpacity(entryMotion, 6) < 1);
  assert(viewMotionPosition(entryMotion, 6).y > 7);
  assert(viewMotionPosition(entryMotion, 6).y < 7.5);
});

Deno.test("remembered terrain stays stale until seen again, including after master travel", () => {
  const world = createAuthoredWorld();
  const viewer = addPlayer(world, "viewer", { x: 7, y: 8, z: 0 });
  const sight = createVisibility();
  const remembered = new Map();
  entityView(world, "viewer", sight, remembered);
  const knownBeforeMaster = new Set(sight.visible);
  const rememberedBeforeMaster = snapshotChunks(remembered);
  viewer.x = 9;
  viewer.y = 8;
  // Master mode sends the full world but does not call entityView.
  viewer.x = 10;
  viewer.y = 8;
  assertEquals(snapshotChunks(remembered), rememberedBeforeMaster);
  assertEquals([...sight.visible], [...knownBeforeMaster]);
  assertEquals(seenMaterial({ chunks: remembered }, 6, 8, 0), OPEN);
  writeTile(world, 6, 8, 0, STONE);
  entityView(world, "viewer", sight, remembered);
  assertEquals(seenMaterial({ chunks: remembered }, 6, 8, 0), OPEN);
  assert(sight.memory.has(tileKey(6, 8, 0)));
  viewer.x = 7;
  entityView(world, "viewer", sight, remembered);
  assertEquals(seenMaterial({ chunks: remembered }, 6, 8, 0), STONE);
});
