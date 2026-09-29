// @ts-check

import { addPlayer, startMove } from "./world.js";
import { enableLocomotion, moveEntity } from "./locomotion.js";

/** @typedef {import('./world.js').World} World */

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** One corner NPC uses the same tile move as a person. */
/** @param {World} world */
export function createCornerNpc(world) {
  const npc = addPlayer(world, "npc-corner", { x: 2, y: 2, z: 0 });
  if (world.players.self?.free) {
    enableLocomotion(npc);
    const waypoints = [
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 2 },
    ];
    let waypoint = 0;
    let visits = 0;
    let pauseUntil = 0;
    return () => {
      if (world.tick < pauseUntil) {
        return moveEntity(world, npc.id, 0, 0);
      }
      const target = waypoints[waypoint];
      if (Math.hypot(npc.x - target.x, npc.y - target.y) < 0.11) {
        waypoint = (waypoint + 1) % waypoints.length;
        visits++;
        if (visits % 8 === 0) pauseUntil = world.tick + 20;
      }
      const next = waypoints[waypoint];
      return moveEntity(
        world,
        npc.id,
        Math.abs(next.x - npc.x) > 0.1 ? Math.sign(next.x - npc.x) : 0,
        Math.abs(next.y - npc.y) > 0.1 ? Math.sign(next.y - npc.y) : 0,
      );
    };
  }
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
