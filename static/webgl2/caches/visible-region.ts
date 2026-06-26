import {
  type ChunkKey,
  computeStreamingChunks,
  computeVisibleChunks,
  TILE_SIZE_PX,
} from "../../../lib/webgl-chunk-gen.ts";

export type VisibleRegion = {
  visibleChunkKeys: ChunkKey[];
  streamingChunkKeys: ChunkKey[];
  visibleTileBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
};

let lastVisibleRegion: VisibleRegion | null = null;

export function updateVisibleRegion(
  camera: { x: number; y: number; zoom: number },
  viewport: { fbWidth: number; fbHeight: number },
  viewZ: number,
): VisibleRegion {
  const visibleXY = computeVisibleChunks(
    camera,
    {
      framebufferWidth: viewport.fbWidth,
      framebufferHeight: viewport.fbHeight,
    },
  );
  const streamingXY = computeStreamingChunks(
    camera,
    {
      framebufferWidth: viewport.fbWidth,
      framebufferHeight: viewport.fbHeight,
    },
    1,
  );
  const halfW = viewport.fbWidth / (2 * camera.zoom);
  const halfH = viewport.fbHeight / (2 * camera.zoom);
  lastVisibleRegion = {
    visibleChunkKeys: visibleXY.map((key) => ({ ...key, chunkZ: viewZ })),
    streamingChunkKeys: streamingXY.map((key) => ({ ...key, chunkZ: viewZ })),
    visibleTileBounds: {
      minX: Math.floor((camera.x - halfW) / TILE_SIZE_PX),
      minY: Math.floor((camera.y - halfH) / TILE_SIZE_PX),
      maxX: Math.floor((camera.x + halfW) / TILE_SIZE_PX),
      maxY: Math.floor((camera.y + halfH) / TILE_SIZE_PX),
    },
  };
  return lastVisibleRegion;
}

export function getVisibleRegion(): VisibleRegion | null {
  return lastVisibleRegion;
}
