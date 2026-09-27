// @ts-check

import { addPlayer, startMove } from "./world.js";

/** @typedef {import('./world.js').World} World */

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** One corner NPC uses the same tile move as a person. */
/** @param {World} world */
export function createCornerNpc(world) {
  addPlayer(world, "npc-corner", { x: 2, y: 2, z: 0 });
  let step = 0;
  let pauseUntil = 0;
  return () => {
    const npc = world.players["npc-corner"];
    if (!npc || npc.move || world.tick < pauseUntil) return false;
    const [dx, dy] = DIRECTIONS[step % DIRECTIONS.length];
    const result = startMove(world, npc.id, dx, dy, step + 1);
    if (!result.ok) return false;
    step++;
    if (step % 8 === 0 && result.move) {
      pauseUntil = world.tick + result.move.durationTicks + 20;
    }
    return true;
  };
}
