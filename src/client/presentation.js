// @ts-check

import { renderPosition, TICK_MS } from "../shared/world.js";
import { viewMotionPosition } from "../shared/view.js";

/** @typedef {import('../shared/world.js').Player} Player */
/** @typedef {import('../shared/world.js').Tile} Tile */

/** Follow the newest simulation position without replaying a backlog of old moves. */
export function createPresentation() {
  /** @type {Map<string,{position:Tile,tick:number,time?:number}>} */
  const entries = new Map();
  /** @type {Map<string,{tick:number,position:Tile}[]>} */
  const samples = new Map();
  let clockBase = Infinity;

  /** @param {Player} player @param {number} tick */
  function observe(player, tick) {
    if (!player.free) return;
    const now = performance.now();
    clockBase = Math.min(clockBase, now - tick * TICK_MS);
    const list = samples.get(player.id) ?? [];
    if (list.length && tick <= list[list.length - 1].tick) return;
    list.push({ tick, position: renderPosition(player, tick) });
    if (list.length > 12) list.shift();
    samples.set(player.id, list);
  }

  /** @param {string} id */
  function delayedPosition(id) {
    const list = samples.get(id);
    if (!list?.length) return null;
    const tick = (performance.now() - 150 - clockBase) / TICK_MS;
    if (tick <= list[0].tick) return list[0].position;
    for (let i = 1; i < list.length; i++) {
      if (tick > list[i].tick) continue;
      const a = list[i - 1];
      const b = list[i];
      const alpha = (tick - a.tick) / (b.tick - a.tick);
      return {
        x: a.position.x + (b.position.x - a.position.x) * alpha,
        y: a.position.y + (b.position.y - a.position.y) * alpha,
        z: a.position.z + (b.position.z - a.position.z) * alpha,
      };
    }
    return list[list.length - 1].position;
  }

  /** @param {Player} player @param {number} tick @param {boolean} local */
  function positionAt(player, tick, local) {
    if (player.free && !local) {
      const target = delayedPosition(player.id) ?? renderPosition(player, tick);
      const now = performance.now();
      const entry = entries.get(player.id);
      if (!entry || tick < entry.tick) {
        entries.set(player.id, { position: target, tick, time: now });
        return target;
      }
      const distance = Math.hypot(
        target.x - entry.position.x,
        target.y - entry.position.y,
        target.z - entry.position.z,
      );
      const elapsed = Math.max(0, now - (entry.time ?? now));
      const step = Math.min(distance, elapsed * 4 / 1000);
      if (distance > 0 && step > 0) {
        entry.position = {
          x: entry.position.x + (target.x - entry.position.x) * step / distance,
          y: entry.position.y + (target.y - entry.position.y) * step / distance,
          z: entry.position.z + (target.z - entry.position.z) * step / distance,
        };
      }
      entry.tick = tick;
      entry.time = now;
      return entry.position;
    }
    const target = player.viewMotion
      ? viewMotionPosition(player.viewMotion, tick)
      : renderPosition(player, tick);
    if (local) return target;
    let entry = entries.get(player.id);
    if (!entry || tick < entry.tick) {
      entry = { position: target, tick };
      entries.set(player.id, entry);
      return target;
    }
    const elapsed = Math.max(0, tick - entry.tick);
    const difference = {
      x: target.x - entry.position.x,
      y: target.y - entry.position.y,
      z: target.z - entry.position.z,
    };
    const distance = Math.hypot(difference.x, difference.y, difference.z);
    if (distance > 0 && elapsed > 0) {
      const fraction = 1 - Math.exp(-elapsed / 1.5);
      const step = Math.min(distance * fraction, elapsed * 0.125);
      entry.position = {
        x: entry.position.x + difference.x / distance * step,
        y: entry.position.y + difference.y / distance * step,
        z: entry.position.z + difference.z / distance * step,
      };
    }
    // An unseen turn or a delayed snapshot must not leave the sprite on
    // another part of the map while the simulation has already moved on.
    const remaining = Math.hypot(
      target.x - entry.position.x,
      target.y - entry.position.y,
      target.z - entry.position.z,
    );
    if (remaining > 0.75) {
      const fraction = 0.75 / remaining;
      entry.position = {
        x: target.x + (entry.position.x - target.x) * fraction,
        y: target.y + (entry.position.y - target.y) * fraction,
        z: target.z + (entry.position.z - target.z) * fraction,
      };
    }
    entry.tick = tick;
    return entry.position;
  }

  return {
    positionAt,
    observe,
    reset() {
      entries.clear();
      samples.clear();
      clockBase = Infinity;
    },
  };
}
