import {
  CHUNK_EDGE_TILES,
  type ChunkKey,
  chunkKeyString,
  chunkOfTile,
  tileKeyString,
} from "./webgl-chunk-gen.ts";

export type Vec3i = { x: number; y: number; z: number };
export type BlockType = "air" | "solid";

export type TileMemory = {
  block: BlockType;
  tickObserved: number;
};

export type EntityMovementState = {
  origin: Vec3i;
  target: Vec3i;
  startPosition: [number, number, number];
  elapsedTicks: number;
  totalTicks: number;
};

export type EntityState = {
  position: Vec3i;
  facingLeft: boolean;
  isProne: boolean;
  movement: EntityMovementState | null;
};

export type WorldSimState = {
  seed: string;
  tick: number;
  movementTicksPerTile: number;
  entity: EntityState;
  visible: Set<string>;
  memory: Map<string, TileMemory>;
};

export type MoveResult =
  | { ok: true; target: Vec3i }
  | {
    ok: false;
    reason: "moving" | "blocked" | "non_adjacent" | "chunk_unloaded";
  };

const FOV_RADIUS = 20;
const STARTER_ROOM_HALF_EXTENT = 3;
const STARTER_ROOM_MIN_Z = 0;
const STARTER_ROOM_MAX_Z = 1;

function fnv32a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h ^ s.charCodeAt(i), 0x01000193)) >>> 0;
  }
  return h;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function hashUnit(seed: string, x: number, y: number, z: number) {
  return fnv32a(`${seed}:${x}:${y}:${z}`) / 0xffffffff;
}

function valueNoise(seed: string, x: number, y: number, z: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const tz = smoothstep(z - z0);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hashUnit(seed, x0, y0, z0);
  const c100 = hashUnit(seed, x0 + 1, y0, z0);
  const c010 = hashUnit(seed, x0, y0 + 1, z0);
  const c110 = hashUnit(seed, x0 + 1, y0 + 1, z0);
  const c001 = hashUnit(seed, x0, y0, z0 + 1);
  const c101 = hashUnit(seed, x0 + 1, y0, z0 + 1);
  const c011 = hashUnit(seed, x0, y0 + 1, z0 + 1);
  const c111 = hashUnit(seed, x0 + 1, y0 + 1, z0 + 1);

  const x00 = lerp(c000, c100, tx);
  const x10 = lerp(c010, c110, tx);
  const x01 = lerp(c001, c101, tx);
  const x11 = lerp(c011, c111, tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

function caveNoise(seed: string, x: number, y: number, z: number) {
  let value = 0;
  let amp = 0.55;
  let scale = 0.085;
  let ampSum = 0;
  for (let octave = 0; octave < 4; octave++) {
    value += valueNoise(seed, x * scale, y * scale, z * scale * 0.25) * amp;
    ampSum += amp;
    amp *= 0.58;
    scale *= 2;
  }
  return value / ampSum;
}

export function worldBlockAt(seed: string, pos: Vec3i): BlockType {
  const inStarterXY = Math.abs(pos.x) <= STARTER_ROOM_HALF_EXTENT &&
    Math.abs(pos.y) <= STARTER_ROOM_HALF_EXTENT;
  if (
    inStarterXY && pos.z >= STARTER_ROOM_MIN_Z &&
    pos.z <= STARTER_ROOM_MAX_Z
  ) {
    return "air";
  }
  if (
    pos.z >= 0 && pos.z <= 1 && (Math.abs(pos.x) <= 1 || Math.abs(pos.y) <= 1)
  ) {
    return "air";
  }

  if (pos.z === -1) {
    return "solid";
  }

  const verticalBand = Math.abs(pos.z) <= 2;
  const cave = verticalBand && caveNoise(seed, pos.x, pos.y, pos.z) > 0.52;
  if (cave && pos.z >= 0 && pos.z <= 1) {
    return "air";
  }

  return "solid";
}

export function createWorldSim(seed: string): WorldSimState {
  return {
    seed,
    tick: 0,
    movementTicksPerTile: 10,
    entity: {
      position: findSpawnPosition(seed, { x: 0, y: 0, z: 0 }),
      facingLeft: false,
      isProne: false,
      movement: null,
    },
    visible: new Set(),
    memory: new Map(),
  };
}

export function findSpawnPosition(seed: string, preferred: Vec3i): Vec3i {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPos: Vec3i | null = null;
  for (let radius = 0; radius <= 32; radius++) {
    for (let y = preferred.y - radius; y <= preferred.y + radius; y++) {
      for (let x = preferred.x - radius; x <= preferred.x + radius; x++) {
        if (
          Math.abs(x - preferred.x) !== radius &&
          Math.abs(y - preferred.y) !== radius
        ) {
          continue;
        }
        for (let z = preferred.z + 4; z >= preferred.z - 8; z--) {
          const pos = { x, y, z };
          const below = { x, y, z: z - 1 };
          if (
            worldBlockAt(seed, pos) === "air" &&
            worldBlockAt(seed, below) === "solid"
          ) {
            const distance = Math.abs(x - preferred.x) +
              Math.abs(y - preferred.y) +
              Math.abs(z - preferred.z);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestPos = pos;
            }
          }
        }
      }
    }
    if (bestPos) return bestPos;
  }
  return { x: 0, y: 0, z: 0 };
}

export function generateWorldSolidChunk(
  seed: string,
  key: ChunkKey,
): Uint8Array {
  const solid = new Uint8Array(CHUNK_EDGE_TILES * CHUNK_EDGE_TILES);
  const baseX = key.chunkX * CHUNK_EDGE_TILES;
  const baseY = key.chunkY * CHUNK_EDGE_TILES;
  for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
    for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
      solid[ty * CHUNK_EDGE_TILES + tx] = worldBlockAt(seed, {
          x: baseX + tx,
          y: baseY + ty,
          z: key.chunkZ,
        }) === "solid"
        ? 1
        : 0;
    }
  }
  return solid;
}

export function worldPositionToChunk(pos: Vec3i): Vec3i {
  const { chunkX, chunkY } = chunkOfTile(pos.x, pos.y);
  return { x: chunkX, y: chunkY, z: pos.z };
}

function vecAdd(a: Vec3i, b: Vec3i): Vec3i {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sameVec(a: Vec3i, b: Vec3i) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function isSolid(seed: string, pos: Vec3i) {
  return worldBlockAt(seed, pos) === "solid";
}

function isAdjacentDirection(direction: Vec3i) {
  return Math.max(
        Math.abs(direction.x),
        Math.abs(direction.y),
        Math.abs(direction.z),
      ) <= 1 &&
    (direction.x !== 0 || direction.y !== 0 || direction.z !== 0);
}

function movementDistance(direction: Vec3i) {
  return Math.hypot(direction.x, direction.y, direction.z);
}

function movementDistanceBetween(from: [number, number, number], to: Vec3i) {
  return Math.hypot(to.x - from[0], to.y - from[1], to.z - from[2]);
}

function progressPercent(movement: EntityMovementState) {
  return Math.floor(
    (movement.elapsedTicks * 100) / Math.max(1, movement.totalTicks),
  );
}

export function entityRenderPosition(
  entity: EntityState,
): [number, number, number] {
  const movement = entity.movement;
  if (!movement) {
    return [entity.position.x, entity.position.y, entity.position.z];
  }
  const fraction = movement.elapsedTicks / Math.max(1, movement.totalTicks);
  return [
    movement.startPosition[0] +
    (movement.target.x - movement.startPosition[0]) * fraction,
    movement.startPosition[1] +
    (movement.target.y - movement.startPosition[1]) * fraction,
    movement.startPosition[2] +
    (movement.target.z - movement.startPosition[2]) * fraction,
  ];
}

export function entityVisibilityPosition(entity: EntityState): Vec3i {
  const movement = entity.movement;
  if (movement && progressPercent(movement) >= 25) {
    return movement.target;
  }
  return entity.position;
}

function resolveMovementDirection(
  seed: string,
  position: Vec3i,
  dx: number,
  dy: number,
): Vec3i | null {
  const flat = { x: position.x + dx, y: position.y + dy, z: position.z };
  const floor = { x: position.x + dx, y: position.y + dy, z: position.z - 1 };

  if (!isSolid(seed, flat) && isSolid(seed, floor)) {
    return { x: dx, y: dy, z: 0 };
  }

  const stepDest = {
    x: position.x + dx,
    y: position.y + dy,
    z: position.z + 1,
  };
  const headroom = { x: position.x, y: position.y, z: position.z + 1 };
  if (
    isSolid(seed, flat) && !isSolid(seed, stepDest) && !isSolid(seed, headroom)
  ) {
    return { x: dx, y: dy, z: 1 };
  }

  const newFloor = {
    x: position.x + dx,
    y: position.y + dy,
    z: position.z - 2,
  };
  if (
    !isSolid(seed, flat) && !isSolid(seed, floor) && isSolid(seed, newFloor)
  ) {
    return { x: dx, y: dy, z: -1 };
  }

  return null;
}

function diagonalMoveBlocked(seed: string, from: Vec3i, to: Vec3i) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 || dy === 0) return false;

  const sideX = resolveMovementDirection(seed, from, dx, 0);
  const sideY = resolveMovementDirection(seed, from, 0, dy);
  return sideX === null || sideY === null;
}

export function startEntityMove(
  world: WorldSimState,
  direction: Vec3i,
  loadedChunks: ReadonlySet<string>,
): MoveResult {
  if (!isAdjacentDirection(direction)) {
    return { ok: false, reason: "non_adjacent" };
  }
  const current = world.entity;
  if (
    current.movement && sameVec({
      x: Math.sign(current.movement.target.x - current.movement.origin.x),
      y: Math.sign(current.movement.target.y - current.movement.origin.y),
      z: Math.sign(current.movement.target.z - current.movement.origin.z),
    }, direction)
  ) {
    return { ok: false, reason: "moving" };
  }

  let resolved = direction;
  if (direction.z === 0) {
    const terrainDirection = resolveMovementDirection(
      world.seed,
      current.position,
      direction.x,
      direction.y,
    );
    if (!terrainDirection) return { ok: false, reason: "blocked" };
    resolved = terrainDirection;
  }

  const target = vecAdd(current.position, resolved);
  if (diagonalMoveBlocked(world.seed, current.position, target)) {
    return { ok: false, reason: "blocked" };
  }

  const targetChunk = worldPositionToChunk(target);
  if (
    !loadedChunks.has(chunkKeyString({
      chunkX: targetChunk.x,
      chunkY: targetChunk.y,
      chunkZ: targetChunk.z,
    }))
  ) {
    return { ok: false, reason: "chunk_unloaded" };
  }

  const startPosition = current.movement
    ? entityRenderPosition(current)
    : ([current.position.x, current.position.y, current.position.z] as [
      number,
      number,
      number,
    ]);
  const distance = current.movement
    ? movementDistanceBetween(startPosition, target)
    : movementDistance(resolved);
  current.facingLeft = resolved.x < 0
    ? true
    : resolved.x > 0
    ? false
    : current.facingLeft;
  current.movement = {
    origin: current.position,
    target,
    startPosition,
    elapsedTicks: 0,
    totalTicks: Math.max(1, Math.ceil(distance * world.movementTicksPerTile)),
  };
  return { ok: true, target };
}

export function advanceWorldMovement(world: WorldSimState) {
  const movement = world.entity.movement;
  if (!movement) return false;
  movement.elapsedTicks = Math.min(
    movement.elapsedTicks + 1,
    movement.totalTicks,
  );
  if (progressPercent(movement) >= 75) {
    world.entity.position = movement.target;
  }
  if (movement.elapsedTicks >= movement.totalTicks) {
    world.entity.position = movement.target;
    world.entity.movement = null;
  }
  return true;
}

function hasLos(
  seed: string,
  from: Vec3i,
  to: Vec3i,
  solidFn: (x: number, y: number, z: number) => boolean,
): boolean {
  if (sameVec(from, to)) return true;
  const fx = from.x + 0.5;
  const fy = from.y + 0.5;
  const fz = from.z + 0.5;
  const dirX = to.x + 0.5 - fx;
  const dirY = to.y + 0.5 - fy;
  const dirZ = to.z + 0.5 - fz;
  const stepX = dirX >= 0 ? 1 : -1;
  const stepY = dirY >= 0 ? 1 : -1;
  const stepZ = dirZ >= 0 ? 1 : -1;
  const tDeltaX = dirX === 0 ? Infinity : Math.abs(1 / dirX);
  const tDeltaY = dirY === 0 ? Infinity : Math.abs(1 / dirY);
  const tDeltaZ = dirZ === 0 ? Infinity : Math.abs(1 / dirZ);
  let tMaxX = dirX === 0 ? Infinity : 0.5 / Math.abs(dirX);
  let tMaxY = dirY === 0 ? Infinity : 0.5 / Math.abs(dirY);
  let tMaxZ = dirZ === 0 ? Infinity : 0.5 / Math.abs(dirZ);
  let cx = from.x;
  let cy = from.y;
  let cz = from.z;
  const maxSteps = Math.abs(from.x - to.x) + Math.abs(from.y - to.y) +
    Math.abs(from.z - to.z) + 1;

  for (let step = 0; step < maxSteps; step++) {
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      cy += stepY;
      tMaxY += tDeltaY;
    } else {
      cz += stepZ;
      tMaxZ += tDeltaZ;
    }
    if (cx === to.x && cy === to.y && cz === to.z) return true;
    if (solidFn(cx, cy, cz)) return false;
  }
  return true;
}

export function recomputeFov(
  world: WorldSimState,
  // Optional pre-cached solid lookup (O(1) array access vs expensive noise recomputation).
  // Returns undefined if the chunk isn't loaded; falls back to worldBlockAt in that case.
  solidCheck?: (x: number, y: number, z: number) => boolean | undefined,
) {
  const previousVisible = world.visible;
  const nextVisible = new Set<string>();
  const position = entityVisibilityPosition(world.entity);
  const rSq = FOV_RADIUS * FOV_RADIUS;

  // Int8Array memo: -1=unknown, 0=air, 1=solid. Indexed by [dz+R][dy+R][dx+R].
  // Each unique cell is computed at most once regardless of how many DDA paths cross it.
  const D = 2 * FOV_RADIUS + 1;
  const memo = new Int8Array(D * D * D).fill(-1);
  const memoSolid = (x: number, y: number, z: number): boolean => {
    const dx = x - position.x + FOV_RADIUS;
    const dy = y - position.y + FOV_RADIUS;
    const dz = z - position.z + FOV_RADIUS;
    if (dx < 0 || dy < 0 || dz < 0 || dx >= D || dy >= D || dz >= D) {
      return solidCheck?.(x, y, z) ?? isSolid(world.seed, { x, y, z });
    }
    const idx = dz * D * D + dy * D + dx;
    if (memo[idx] < 0) {
      const cached = solidCheck?.(x, y, z);
      memo[idx] = (cached !== undefined ? cached : isSolid(world.seed, { x, y, z })) ? 1 : 0;
    }
    return memo[idx] > 0;
  };

  for (let dz = -FOV_RADIUS; dz <= FOV_RADIUS; dz++) {
    for (let dy = -FOV_RADIUS; dy <= FOV_RADIUS; dy++) {
      for (let dx = -FOV_RADIUS; dx <= FOV_RADIUS; dx++) {
        if (dx * dx + dy * dy + dz * dz > rSq) continue;
        const candidate = {
          x: position.x + dx,
          y: position.y + dy,
          z: position.z + dz,
        };
        if (hasLos(world.seed, position, candidate, memoSolid)) {
          nextVisible.add(tileKeyString({
            tileX: candidate.x,
            tileY: candidate.y,
            tileZ: candidate.z,
          }));
        }
      }
    }
  }

  // "Lit walls": for every visible open tile, also reveal its 4 orthogonal solid
  // neighbors at the same z-level. Prevents the jarring flat wall cutoff at the
  // FOV sphere edge — if you see the floor next to a wall, you see the wall.
  const wallReveal: string[] = [];
  for (const key of nextVisible) {
    const pos = parseTileKey(key);
    if (memoSolid(pos.x, pos.y, pos.z)) continue;
    for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const wx = pos.x + nx;
      const wy = pos.y + ny;
      const wKey = tileKeyString({ tileX: wx, tileY: wy, tileZ: pos.z });
      if (!nextVisible.has(wKey) && memoSolid(wx, wy, pos.z)) {
        wallReveal.push(wKey);
      }
    }
  }
  for (const key of wallReveal) nextVisible.add(key);

  // For every visible open tile at or below the player, also reveal the tile directly
  // below — fills in floors at the base of walls when looking along a corridor.
  const lowerHalf = [...nextVisible].map(parseTileKey).filter((pos) =>
    pos.z <= position.z && !memoSolid(pos.x, pos.y, pos.z)
  );
  for (const pos of lowerHalf) {
    nextVisible.add(
      tileKeyString({ tileX: pos.x, tileY: pos.y, tileZ: pos.z - 1 }),
    );
  }

  for (const key of previousVisible) {
    if (!nextVisible.has(key)) {
      const pos = parseTileKey(key);
      world.memory.set(key, {
        block: worldBlockAt(world.seed, pos),
        tickObserved: world.tick,
      });
    }
  }
  for (const key of nextVisible) {
    world.memory.delete(key);
  }
  world.visible = nextVisible;
}

export function parseTileKey(key: string): Vec3i {
  const [x, y, z] = key.split(",").map(Number);
  return { x, y, z };
}

export function isTileVisible(world: WorldSimState, pos: Vec3i) {
  return world.visible.has(
    tileKeyString({ tileX: pos.x, tileY: pos.y, tileZ: pos.z }),
  );
}

export function isTileRemembered(world: WorldSimState, pos: Vec3i) {
  return world.memory.has(
    tileKeyString({ tileX: pos.x, tileY: pos.y, tileZ: pos.z }),
  );
}
