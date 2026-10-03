// @ts-check

import { renderPosition, TICK_MS } from "../shared/world.js";
import { viewMotionPosition } from "../shared/view.js";
import { entityOpacity, tileVisibility } from "../shared/visibility.js";

/** @typedef {import('../shared/world.js').Player} Player */
/** @typedef {import('../shared/world.js').Tile} Tile */

const CLOCK_WINDOW_MS = 2000;

/** Follow the newest simulation position without replaying a backlog of old moves. */
export function createPresentation() {
  /** @type {Map<string,{position:Tile,tick:number,time?:number}>} */
  const entries = new Map();
  /** @type {Map<string,{tick:number,position:Tile}[]>} */
  const samples = new Map();
  /** @type {Map<string,{player:Player,position:Tile,opacity:number,from:number,to:number,started:number,sample:string,lastSeen:number}>} */
  const sight = new Map();
  /** Recent tick clock offsets in rising order; the first is the window minimum. */
  /** @type {{time:number,offset:number}[]} */
  let offsets = [];
  let clockBase = Infinity;

  /** @param {Player} player @param {number} tick */
  function observe(player, tick) {
    if (!player.free) return;
    const now = performance.now();
    // The earliest recent sample absorbs network jitter. A window, not an
    // all-time minimum, lets the clock follow a lasting shift, such as a
    // hidden tab whose simulation fell behind.
    const offset = now - tick * TICK_MS;
    while (offsets.length && offsets[offsets.length - 1].offset >= offset) {
      offsets.pop();
    }
    offsets.push({ time: now, offset });
    while (now - offsets[0].time > CLOCK_WINDOW_MS) offsets.shift();
    clockBase = offsets[0].offset;
    const list = samples.get(player.id) ?? [];
    if (list.length && tick <= list[list.length - 1].tick) return;
    list.push({
      tick,
      position: player.move
        ? renderPosition(player, tick)
        : { x: player.x, y: player.y, z: player.z },
    });
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

  /** @param {Player[]} players @param {string} localId @param {"entity"|"master"} mode @param {import('../shared/visibility.js').Visibility} visibility @param {number} tick @param {number} [now] */
  function sightEntries(
    players,
    localId,
    mode,
    visibility,
    tick,
    now = performance.now(),
  ) {
    if (mode === "master") sight.clear();
    /** @type {{player:Player,pos:Tile,opacity:number}[]} */
    const result = [];
    const present = new Set();
    for (const player of players) {
      present.add(player.id);
      const pos = positionAt(player, tick, player.id === localId);
      if (mode === "master" || player.id === localId || !player.free) {
        result.push({ player, pos, opacity: 1 });
        continue;
      }
      const target = entityOpacity(
        player,
        tick,
        (x, y, z) => tileVisibility(visibility, x, y, z) === "visible",
        pos,
      );
      const old = sight.get(player.id);
      const current = old
        ? old.from +
          (old.to - old.from) * Math.min(1, (now - old.started) / 150)
        : 0;
      const changed = !old || old.sample !== visibility.sample ||
        old.to === 0 && target > 0;
      const entry = {
        player,
        position: target > 0 ? pos : old?.position ?? pos,
        opacity: changed ? current : target,
        from: changed ? current : target,
        to: target,
        started: changed ? now : old?.started ?? now,
        sample: visibility.sample,
        lastSeen: now,
      };
      if (old && !changed && old.from !== old.to) {
        entry.opacity = current;
        entry.from = old.from;
        entry.started = old.started;
      }
      sight.set(player.id, entry);
      result.push({ player, pos: entry.position, opacity: entry.opacity });
    }
    if (mode === "entity") {
      for (const [id, entry] of sight) {
        if (present.has(id)) continue;
        if (entry.to !== 0) {
          entry.from = entry.opacity;
          entry.to = 0;
          entry.started = now;
        }
        entry.opacity = entry.from *
          Math.max(0, 1 - (now - entry.started) / 150);
        if (entry.opacity <= 0 || now - entry.lastSeen > 150) sight.delete(id);
        else {
          result.push({
            player: entry.player,
            pos: entry.position,
            opacity: entry.opacity,
          });
        }
      }
    }
    return result;
  }

  return {
    positionAt,
    sightEntries,
    observe,
    reset() {
      entries.clear();
      samples.clear();
      sight.clear();
      offsets = [];
      clockBase = Infinity;
    },
  };
}
