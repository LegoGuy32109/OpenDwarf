export const TILE_SIZE_PX = 64;
export const CHUNK_EDGE_TILES = 16;
export const CHUNK_SIZE_PX = TILE_SIZE_PX * CHUNK_EDGE_TILES;
// StackedTextures.png: 16×496 px → 31 frames of 16 px each
export const FLOOR_FRAMES = 31;
// ShadowAtlas.png / ObscureAtlas.png: 16×240 px → 15 frames (masks 1–15)
export const SHADOW_FRAMES = 15;
// Number of z-levels rendered below the current view level
export const Z_LEVELS_BELOW = 5;

export type ChunkKey = {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
};

export function chunkKeyString(key: ChunkKey): string {
  return `${key.chunkX},${key.chunkY},${key.chunkZ}`;
}

export type TileKey = {
  tileX: number;
  tileY: number;
  tileZ: number;
};

export function tileKeyString(key: TileKey): string {
  return `${key.tileX},${key.tileY},${key.tileZ}`;
}

export function chunkOfTile(tileX: number, tileY: number) {
  return {
    chunkX: Math.floor(tileX / CHUNK_EDGE_TILES),
    chunkY: Math.floor(tileY / CHUNK_EDGE_TILES),
  };
}

function fnv32a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h ^ s.charCodeAt(i), 0x01000193)) >>> 0;
  }
  return h;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

export function generateChunk(seed: string, key: ChunkKey): Uint16Array {
  const combined = `${seed}:${key.chunkX}:${key.chunkY}:${key.chunkZ}`;
  const rng = mulberry32(fnv32a(combined));
  const count = CHUNK_EDGE_TILES * CHUNK_EDGE_TILES;
  const tiles = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    tiles[i] = Math.floor(rng() * 65536);
  }
  return tiles;
}

// Returns a solid mask for one chunk: 1 = stone, 0 = air. ~55% solid.
export function generateChunkSolid(seed: string, key: ChunkKey): Uint8Array {
  const combined = `${seed}:solid:${key.chunkX}:${key.chunkY}:${key.chunkZ}`;
  const rng = mulberry32(fnv32a(combined));
  const count = CHUNK_EDGE_TILES * CHUNK_EDGE_TILES;
  const solid = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    solid[i] = rng() < 0.55 ? 1 : 0;
  }
  return solid;
}

const E = CHUNK_EDGE_TILES;

// ShadowAtlas.png was authored in screen space. The mask builders use world
// tile offsets where +Y is south/down, so atlas lookup needs the north/south
// corners swapped or horizontal ledge shadows land on the rock instead of air.
export function shadowMaskToAtlasId(mask: number): number {
  return ((mask & 1) << 2) |
    (mask & 2 ? 8 : 0) |
    ((mask & 4) >> 2) |
    (mask & 8 ? 2 : 0);
}

// Dual-grid edge shadow: shadow cell (sx,sy) samples the 2×2 block of floor
// tiles at (sx,sy),(sx+1,sy),(sx,sy+1),(sx+1,sy+1) at z=cz.
// Bits: (0,0)→1, (1,0)→2, (0,1)→4, (1,1)→8. Frame = mask-1 for mask 1–14.
export function computeEdgeShadowIds(
  cx: number,
  cy: number,
  cz: number,
  solidCache: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const self = solidCache.get(
    chunkKeyString({ chunkX: cx, chunkY: cy, chunkZ: cz }),
  );
  const result = new Uint8Array(E * E);
  if (!self) return result;

  const nbE = solidCache.get(
    chunkKeyString({ chunkX: cx + 1, chunkY: cy, chunkZ: cz }),
  );
  const nbS = solidCache.get(
    chunkKeyString({ chunkX: cx, chunkY: cy + 1, chunkZ: cz }),
  );
  const nbSE = solidCache.get(
    chunkKeyString({ chunkX: cx + 1, chunkY: cy + 1, chunkZ: cz }),
  );

  const isSolid = (tx: number, ty: number): boolean => {
    if (tx < E && ty < E) return self[ty * E + tx] === 1;
    if (tx >= E && ty < E) return nbE ? nbE[ty * E] === 1 : true;
    if (tx < E) return nbS ? nbS[tx] === 1 : true;
    return nbSE ? nbSE[0] === 1 : true;
  };

  for (let sy = 0; sy < E; sy++) {
    for (let sx = 0; sx < E; sx++) {
      let mask = 0;
      if (isSolid(sx, sy)) mask |= 1;
      if (isSolid(sx + 1, sy)) mask |= 2;
      if (isSolid(sx, sy + 1)) mask |= 4;
      if (isSolid(sx + 1, sy + 1)) mask |= 8;
      if (mask > 0 && mask < 15) {
        result[sy * E + sx] = shadowMaskToAtlasId(mask);
      }
    }
  }
  return result;
}

function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

function tileSolidAt(
  tileX: number,
  tileY: number,
  tileZ: number,
  solidCache: ReadonlyMap<string, Uint8Array>,
): boolean {
  const { chunkX, chunkY } = chunkOfTile(tileX, tileY);
  const chunk = solidCache.get(
    chunkKeyString({ chunkX, chunkY, chunkZ: tileZ }),
  );
  if (!chunk) return true;
  const localX = tileX - chunkX * CHUNK_EDGE_TILES;
  const localY = tileY - chunkY * CHUNK_EDGE_TILES;
  return chunk[localY * CHUNK_EDGE_TILES + localX] === 1;
}

export function computeVisibleTilesFromPlayer(
  player: { tileX: number; tileY: number; tileZ: number },
  radius: number,
  solidCache: ReadonlyMap<string, Uint8Array>,
): Set<string> {
  const visible = new Set<string>();
  const radiusSquared = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radiusSquared) continue;
      const targetX = player.tileX + dx;
      const targetY = player.tileY + dy;
      const line = bresenhamLine(player.tileX, player.tileY, targetX, targetY);
      let blocked = false;
      for (let i = 1; i < line.length - 1; i++) {
        const [lx, ly] = line[i];
        if (tileSolidAt(lx, ly, player.tileZ, solidCache)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        visible.add(tileKeyString({
          tileX: targetX,
          tileY: targetY,
          tileZ: player.tileZ,
        }));
      }
    }
  }
  return visible;
}

// Dual-grid edge shadow from precomputed visible surface elevations.
// topmostOffset values are relative to viewZ: 0 is current level, negatives are
// lower visible levels, and 127 means no visible solid in the depth stack.
export function computeElevationEdgeShadowIds(
  cx: number,
  cy: number,
  viewZ: number,
  topmostOffsetCache: ReadonlyMap<string, Int8Array>,
): Uint8Array {
  const self = topmostOffsetCache.get(
    chunkKeyString({ chunkX: cx, chunkY: cy, chunkZ: viewZ }),
  );
  const result = new Uint8Array(E * E);
  if (!self) return result;

  const nbE = topmostOffsetCache.get(
    chunkKeyString({ chunkX: cx + 1, chunkY: cy, chunkZ: viewZ }),
  );
  const nbS = topmostOffsetCache.get(
    chunkKeyString({ chunkX: cx, chunkY: cy + 1, chunkZ: viewZ }),
  );
  const nbSE = topmostOffsetCache.get(
    chunkKeyString({ chunkX: cx + 1, chunkY: cy + 1, chunkZ: viewZ }),
  );

  const getOffset = (tx: number, ty: number): number => {
    if (tx < E && ty < E) return self[ty * E + tx];
    if (tx >= E && ty < E) return nbE ? nbE[ty * E] : 127;
    if (tx < E) return nbS ? nbS[tx] : 127;
    return nbSE ? nbSE[0] : 127;
  };

  for (let sy = 0; sy < E; sy++) {
    for (let sx = 0; sx < E; sx++) {
      const z00 = getOffset(sx, sy);
      const z10 = getOffset(sx + 1, sy);
      const z01 = getOffset(sx, sy + 1);
      const z11 = getOffset(sx + 1, sy + 1);
      const highest = Math.max(
        z00 === 127 ? -128 : z00,
        z10 === 127 ? -128 : z10,
        z01 === 127 ? -128 : z01,
        z11 === 127 ? -128 : z11,
      );
      if (highest === -128) continue;

      let mask = 0;
      if (z00 === highest) mask |= 1;
      if (z10 === highest) mask |= 2;
      if (z01 === highest) mask |= 4;
      if (z11 === highest) mask |= 8;
      if (mask > 0 && mask < 15) {
        result[sy * E + sx] = shadowMaskToAtlasId(mask);
      }
    }
  }
  return result;
}

// Dual-grid ceiling shadow: shadow cell (sx,sy) samples the same 2×2 block.
// A corner contributes when the block directly above it is solid, even if the
// current viewZ tile is air. This intentionally differs from the Rust renderer
// so ceiling silhouettes can communicate overhead terrain to the player.
// Bits: (0,0)→1, (1,0)→2, (0,1)→4, (1,1)→8. Frame = mask-1 for mask 1–15.
export function computeCeilingShadowIds(
  cx: number,
  cy: number,
  viewZ: number,
  solidCache: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const result = new Uint8Array(E * E);

  const get = (gx: number, gy: number, z: number) =>
    solidCache.get(chunkKeyString({ chunkX: gx, chunkY: gy, chunkZ: z }));

  const ceilSelf = get(cx, cy, viewZ + 1);
  if (!ceilSelf) return result;

  const ceilNbE = get(cx + 1, cy, viewZ + 1);
  const ceilNbS = get(cx, cy + 1, viewZ + 1);
  const ceilNbSE = get(cx + 1, cy + 1, viewZ + 1);

  const getSolid = (
    self: Uint8Array,
    eNb: Uint8Array | undefined,
    sNb: Uint8Array | undefined,
    seNb: Uint8Array | undefined,
    tx: number,
    ty: number,
  ): boolean => {
    if (tx < E && ty < E) return self[ty * E + tx] === 1;
    if (tx >= E && ty < E) return eNb ? eNb[ty * E] === 1 : true;
    if (tx < E) return sNb ? sNb[tx] === 1 : true;
    return seNb ? seNb[0] === 1 : true;
  };

  for (let sy = 0; sy < E; sy++) {
    for (let sx = 0; sx < E; sx++) {
      let maskCeil = 0;
      if (getSolid(ceilSelf, ceilNbE, ceilNbS, ceilNbSE, sx, sy)) {
        maskCeil |= 1;
      }
      if (getSolid(ceilSelf, ceilNbE, ceilNbS, ceilNbSE, sx + 1, sy)) {
        maskCeil |= 2;
      }
      if (getSolid(ceilSelf, ceilNbE, ceilNbS, ceilNbSE, sx, sy + 1)) {
        maskCeil |= 4;
      }
      if (getSolid(ceilSelf, ceilNbE, ceilNbS, ceilNbSE, sx + 1, sy + 1)) {
        maskCeil |= 8;
      }
      if (maskCeil !== 0) {
        result[sy * E + sx] = shadowMaskToAtlasId(maskCeil);
      }
    }
  }
  return result;
}

// Maintains solid mask data for all z-levels needed by the depth stack.
// Covers viewZ+1 (ceiling check) down to viewZ-Z_LEVELS_BELOW.
// streamingXYKeys: xy chunks in the streaming window (chunkZ values are ignored).
export function updateSolidCache(
  solidCache: Map<string, Uint8Array>,
  seed: string,
  streamingXYKeys: ChunkKey[],
  viewZ: number,
): boolean {
  const wanted = new Set<string>();
  for (const { chunkX, chunkY } of streamingXYKeys) {
    for (let z = viewZ - Z_LEVELS_BELOW; z <= viewZ + 1; z++) {
      wanted.add(chunkKeyString({ chunkX, chunkY, chunkZ: z }));
    }
  }
  let changed = false;
  for (const key of [...solidCache.keys()]) {
    if (!wanted.has(key)) {
      solidCache.delete(key);
      changed = true;
    }
  }
  for (const ks of wanted) {
    if (!solidCache.has(ks)) {
      const parts = ks.split(",");
      solidCache.set(
        ks,
        generateChunkSolid(seed, {
          chunkX: Number(parts[0]),
          chunkY: Number(parts[1]),
          chunkZ: Number(parts[2]),
        }),
      );
      changed = true;
    }
  }
  return changed;
}

// Maintains floor tile-ID data for all z-levels in the depth stack.
// Covers viewZ down to viewZ-Z_LEVELS_BELOW.
export function updateFloorCache(
  floorCache: Map<string, Uint16Array>,
  seed: string,
  streamingXYKeys: ChunkKey[],
  viewZ: number,
): boolean {
  const wanted = new Set<string>();
  for (const { chunkX, chunkY } of streamingXYKeys) {
    for (let z = viewZ - Z_LEVELS_BELOW; z <= viewZ; z++) {
      wanted.add(chunkKeyString({ chunkX, chunkY, chunkZ: z }));
    }
  }
  let changed = false;
  for (const key of [...floorCache.keys()]) {
    if (!wanted.has(key)) {
      floorCache.delete(key);
      changed = true;
    }
  }
  for (const ks of wanted) {
    if (!floorCache.has(ks)) {
      const parts = ks.split(",");
      floorCache.set(
        ks,
        generateChunk(seed, {
          chunkX: Number(parts[0]),
          chunkY: Number(parts[1]),
          chunkZ: Number(parts[2]),
        }),
      );
      changed = true;
    }
  }
  return changed;
}

export function computeVisibleChunks(
  camera: { x: number; y: number; zoom: number },
  viewport: { framebufferWidth: number; framebufferHeight: number },
): ChunkKey[] {
  const halfW = viewport.framebufferWidth / (2 * camera.zoom);
  const halfH = viewport.framebufferHeight / (2 * camera.zoom);
  const minChunkX = Math.floor((camera.x - halfW) / CHUNK_SIZE_PX);
  const maxChunkX = Math.floor((camera.x + halfW) / CHUNK_SIZE_PX);
  const minChunkY = Math.floor((camera.y - halfH) / CHUNK_SIZE_PX);
  const maxChunkY = Math.floor((camera.y + halfH) / CHUNK_SIZE_PX);
  const visible: ChunkKey[] = [];
  for (let cy = minChunkY; cy <= maxChunkY; cy++) {
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      visible.push({ chunkX: cx, chunkY: cy, chunkZ: 0 });
    }
  }
  return visible;
}

export function computeStreamingChunks(
  camera: { x: number; y: number; zoom: number },
  viewport: { framebufferWidth: number; framebufferHeight: number },
  padding = 1,
): ChunkKey[] {
  const halfW = viewport.framebufferWidth / (2 * camera.zoom);
  const halfH = viewport.framebufferHeight / (2 * camera.zoom);
  const minChunkX = Math.floor((camera.x - halfW) / CHUNK_SIZE_PX) - padding;
  const maxChunkX = Math.floor((camera.x + halfW) / CHUNK_SIZE_PX) + padding;
  const minChunkY = Math.floor((camera.y - halfH) / CHUNK_SIZE_PX) - padding;
  const maxChunkY = Math.floor((camera.y + halfH) / CHUNK_SIZE_PX) + padding;
  const keys: ChunkKey[] = [];
  for (let cy = minChunkY; cy <= maxChunkY; cy++) {
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      keys.push({ chunkX: cx, chunkY: cy, chunkZ: 0 });
    }
  }
  return keys;
}

export function updateChunkCache(
  cache: Map<string, Uint16Array>,
  seed: string,
  streamingKeys: ChunkKey[],
): boolean {
  const wanted = new Set(streamingKeys.map(chunkKeyString));
  let changed = false;
  for (const key of [...cache.keys()]) {
    if (!wanted.has(key)) {
      cache.delete(key);
      changed = true;
    }
  }
  for (const key of streamingKeys) {
    const ks = chunkKeyString(key);
    if (!cache.has(ks)) {
      cache.set(ks, generateChunk(seed, key));
      changed = true;
    }
  }
  return changed;
}
