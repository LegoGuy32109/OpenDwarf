// @ts-check
import { centerTile } from "../shared/locomotion.js";
import { tileVisibility } from "../shared/visibility.js";

/** A host may retain hidden throws; entity view draws only currently visible flight. */
/** @param {Pick<import('./scene-types.js').Scene,'viewZ'|'viewMode'|'visibility'>} scene @param {import('../shared/single-plane.js').ThrownItem} entry */
export function throwVisible(scene, entry) {
  return entry.z === scene.viewZ &&
    (scene.viewMode === "master" ||
      tileVisibility(
          scene.visibility,
          centerTile(entry.x),
          centerTile(entry.y),
          entry.z,
        ) === "visible");
}
