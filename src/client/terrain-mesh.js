// @ts-check

import { materialInfo, ORE_FRAMES } from "../shared/materials.js";
import {
  ceilingMask,
  DEPTH_TINTS,
  elevationMask,
  shadowMaskToAtlasId,
  surfaceGrid,
} from "../shared/surface.js";
import { CHUNK_EDGE, chunkVersion, getChunk } from "../shared/terrain.js";

/**
 * Master view terrain geometry, built once per chunk and reused while nothing
 * it reads changes (docs/features/render-performance.md). A mesh holds the quads
 * of one chunk's tiles in the draw passes `render.js` makes: the floor, the ore
 * tops, the edge shading, the ledge bands, and the ceiling shading. Entity view
 * does not use it, because its look depends on what the player sees.
 */

export const TILE = 64;
export const FLOATS_PER_QUAD = 48;
/** @type {[number,number,number,number]} */
const FLOOR_UV = [0, 5 / 31, 1, 1 / 31];
/** @type {[number,number,number,number][]} */
const DEPTH_COLORS = DEPTH_TINTS.map(([r, g, b]) => [r, g, b, 1]);
/** @type {[number,number,number,number]} */
const EDGE_COLOR = [1, 1, 1, 0.4];
/** @type {[number,number,number,number]} */
const CEILING_COLOR = [1, 1, 1, 0.55];
/** @type {[number,number,number,number]} */
const WHITE_UV = [0, 0, 1, 1];
/** @type {[number,number,number,number]} */
const BAND_DARK = [0, 0, 0, 0.28];
/** @type {[number,number,number,number]} */
const BAND_LIGHT = [0, 0, 0, 0.11];
const SIDE = CHUNK_EDGE;

/** The texture each pass of a mesh draws with, in draw order. */
export const MESH_PASSES = ["floor", "ores", "edge", "bands", "ceiling"];

/** @typedef {"floor"|"ores"|"edge"|"bands"|"ceiling"} MeshPass */
/** @typedef {{data:Float32Array,used:number}} QuadBuffer */
/** @typedef {{viewZ:number,chunks:(Uint8Array|null)[],versions:number[],tiles:number}} MeshStamp What a mesh was built from: the level, and the data and version of the chunk and its right, lower and diagonal neighbors, which its edge tiles read. */
/** @typedef {MeshStamp&{parts:Record<MeshPass,Float32Array>}} TerrainMesh A stamp and the vertices of each pass. */

/** @returns {QuadBuffer} */
function buffer() {
  return { data: new Float32Array(FLOATS_PER_QUAD * 64), used: 0 };
}

/** @param {Float32Array} d @param {number} at @param {number} x @param {number} y @param {number} u @param {number} v @param {number} r @param {number} g @param {number} b @param {number} a */
function vertex(d, at, x, y, u, v, r, g, b, a) {
  d[at] = x;
  d[at + 1] = y;
  d[at + 2] = u;
  d[at + 3] = v;
  d[at + 4] = r;
  d[at + 5] = g;
  d[at + 6] = b;
  d[at + 7] = a;
}

/** @param {QuadBuffer} out @param {number} x @param {number} y @param {number} w @param {number} h @param {[number,number,number,number]} uv @param {[number,number,number,number]} color */
function quad(out, x, y, w, h, uv, color) {
  if (out.used + FLOATS_PER_QUAD > out.data.length) {
    const grown = new Float32Array(out.data.length * 2);
    grown.set(out.data.subarray(0, out.used));
    out.data = grown;
  }
  const d = out.data;
  const u = uv[0], v = uv[1], u1 = u + uv[2], v1 = v + uv[3];
  const r = color[0], g = color[1], b = color[2], a = color[3];
  const x1 = x + w, y1 = y + h;
  const at = out.used;
  vertex(d, at, x, y, u, v, r, g, b, a);
  vertex(d, at + 8, x1, y, u1, v, r, g, b, a);
  vertex(d, at + 16, x, y1, u, v1, r, g, b, a);
  vertex(d, at + 24, x, y1, u, v1, r, g, b, a);
  vertex(d, at + 32, x1, y, u1, v, r, g, b, a);
  vertex(d, at + 40, x1, y1, u1, v1, r, g, b, a);
  out.used += FLOATS_PER_QUAD;
}

/**
 * The chunks whose tiles a mesh of chunk (cx, cy) reads: itself and the three
 * neighbors to its right and below, because masks and ledge bands read the next
 * tile over.
 * @param {import('../shared/world.js').World} world @param {number} cx @param {number} cy
 */
function sources(world, cx, cy) {
  return [
    getChunk(world, cx, cy),
    getChunk(world, cx + 1, cy),
    getChunk(world, cx, cy + 1),
    getChunk(world, cx + 1, cy + 1),
  ];
}

/**
 * Whether `mesh` still matches the world: the same level, and the same data
 * and version in each chunk it read. A tile write, a reveal, a chunk load, and
 * a chunk unload each fail this check.
 * @param {MeshStamp} mesh @param {import('../shared/world.js').World} world @param {number} cx @param {number} cy @param {number} viewZ
 */
export function meshIsFresh(mesh, world, cx, cy, viewZ) {
  if (mesh.viewZ !== viewZ) return false;
  const now = sources(world, cx, cy);
  for (let i = 0; i < 4; i++) {
    if (
      now[i] !== mesh.chunks[i] ||
      chunkVersion(now[i]) !== mesh.versions[i]
    ) return false;
  }
  return true;
}

/**
 * Build the master view mesh of chunk (cx, cy) at `viewZ`. It makes the same
 * quads, with the same values, as the per-tile loops it replaced.
 * @param {import('../shared/world.js').World} world @param {number} cx @param {number} cy @param {number} viewZ
 * @param {import('../shared/visibility.js').Visibility} visibility Ignored in master view.
 * @returns {TerrainMesh}
 */
export function buildTerrainMesh(world, cx, cy, viewZ, visibility) {
  const chunks = sources(world, cx, cy);
  const left = cx * SIDE;
  const top = cy * SIDE;
  const surface = surfaceGrid(
    world,
    left,
    top,
    SIDE + 1,
    SIDE + 1,
    viewZ,
    "master",
    visibility,
  );
  const floor = buffer(), ores = buffer(), edge = buffer(), bands = buffer();
  const ceiling = buffer();
  let tiles = 0;
  for (let y = top; y < top + SIDE; y++) {
    for (let x = left; x < left + SIDE; x++) {
      const tile = surface(x, y);
      if (!tile) continue;
      tiles++;
      const oreFrame = materialInfo(tile.material)?.oreFrame;
      if (oreFrame !== null && oreFrame !== undefined) {
        quad(
          ores,
          x * TILE,
          y * TILE,
          TILE,
          TILE,
          [0, oreFrame / ORE_FRAMES, 1, 1 / ORE_FRAMES],
          DEPTH_COLORS[tile.depth],
        );
      } else {
        quad(
          floor,
          x * TILE,
          y * TILE,
          TILE,
          TILE,
          FLOOR_UV,
          DEPTH_COLORS[tile.depth],
        );
      }
    }
  }
  for (let y = top; y < top + SIDE; y++) {
    for (let x = left; x < left + SIDE; x++) {
      const mask = elevationMask(
        world,
        x,
        y,
        viewZ,
        "master",
        visibility,
        surface,
      );
      if (!mask) continue;
      const frame = shadowMaskToAtlasId(mask) - 1;
      quad(
        edge,
        (x + 0.5) * TILE,
        (y + 0.5) * TILE,
        TILE,
        TILE,
        [0, frame / 15, 1, 1 / 15],
        EDGE_COLOR,
      );
    }
  }
  for (let y = top; y < top + SIDE; y++) {
    for (let x = left; x < left + SIDE; x++) {
      const here = surface(x, y);
      if (!here) continue;
      const rightTile = surface(x + 1, y);
      const downTile = surface(x, y + 1);
      if (rightTile?.depth !== here.depth) {
        const lowerRight = !rightTile || rightTile.depth > here.depth;
        const edgeX = (x + 1) * TILE;
        quad(
          bands,
          edgeX + (lowerRight ? 0 : -4),
          y * TILE,
          4,
          TILE,
          WHITE_UV,
          BAND_DARK,
        );
        quad(
          bands,
          edgeX + (lowerRight ? 4 : -8),
          y * TILE,
          4,
          TILE,
          WHITE_UV,
          BAND_LIGHT,
        );
      }
      if (downTile?.depth !== here.depth) {
        const lowerDown = !downTile || downTile.depth > here.depth;
        const edgeY = (y + 1) * TILE;
        quad(
          bands,
          x * TILE,
          edgeY + (lowerDown ? 0 : -4),
          TILE,
          4,
          WHITE_UV,
          BAND_DARK,
        );
        quad(
          bands,
          x * TILE,
          edgeY + (lowerDown ? 4 : -8),
          TILE,
          4,
          WHITE_UV,
          BAND_LIGHT,
        );
      }
    }
  }
  for (let y = top; y < top + SIDE; y++) {
    for (let x = left; x < left + SIDE; x++) {
      const mask = ceilingMask(
        world,
        x,
        y,
        viewZ,
        "master",
        visibility,
        surface,
      );
      if (!mask) continue;
      const frame = shadowMaskToAtlasId(mask) - 1;
      quad(
        ceiling,
        (x + 0.5) * TILE,
        (y + 0.5) * TILE,
        TILE,
        TILE,
        [0, frame / 15, 1, 1 / 15],
        CEILING_COLOR,
      );
    }
  }
  /** @param {QuadBuffer} out */
  const sealed = (out) => out.data.slice(0, out.used);
  return {
    viewZ,
    chunks,
    versions: chunks.map(chunkVersion),
    parts: {
      floor: sealed(floor),
      ores: sealed(ores),
      edge: sealed(edge),
      bands: sealed(bands),
      ceiling: sealed(ceiling),
    },
    tiles,
  };
}
