// @ts-check
// Geometry of the narrow bands along a change in terrain depth.

/** @param {import('./surface.js').SurfaceLookup} surface
 * @param {number} x @param {number} y @param {number} tileSize
 * @param {(x:number,y:number,w:number,h:number,alpha:number)=>void} emit */
export function terrainBands(surface, x, y, tileSize, emit) {
  const here = surface(x, y);
  if (!here) return;
  const right = surface(x + 1, y), down = surface(x, y + 1);
  if (right?.depth !== here.depth) {
    const lower = !right || right.depth > here.depth;
    const edge = (x + 1) * tileSize;
    emit(edge + (lower ? 0 : -4), y * tileSize, 4, tileSize, 0.28);
    emit(edge + (lower ? 4 : -8), y * tileSize, 4, tileSize, 0.11);
  }
  if (down?.depth !== here.depth) {
    const lower = !down || down.depth > here.depth;
    const edge = (y + 1) * tileSize;
    emit(x * tileSize, edge + (lower ? 0 : -4), tileSize, 4, 0.28);
    emit(x * tileSize, edge + (lower ? 4 : -8), tileSize, 4, 0.11);
  }
}
