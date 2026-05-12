export const TILE_SIZE_PX = 64;
export const CHUNK_EDGE_TILES = 16;
export const CHUNK_SIZE_PX = TILE_SIZE_PX * CHUNK_EDGE_TILES;

export type ChunkKey = {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
};

export function chunkKeyString(key: ChunkKey): string {
  return `${key.chunkX},${key.chunkY},${key.chunkZ}`;
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
