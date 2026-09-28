// @ts-check

/** @typedef {import('../shared/world.js').Player} Player */
/** @typedef {import('../shared/world.js').Move} Move */
/** @typedef {import('../shared/world.js').Tile} Tile */

/** Delay every remote entity's visual move by two simulation ticks. */
export function createPresentation() {
  /** @type {Map<string,{key:string,move:Move|null,next:Move[],settled:Tile}>} */
  const entries = new Map();

  /** @param {Player} player @param {number} tick @param {boolean} local */
  function playerAt(player, tick, local) {
    if (local) return player;
    let entry = entries.get(player.id);
    if (!entry) {
      entry = {
        key: "",
        move: null,
        next: [],
        settled: player.move?.startPosition ?? {
          x: player.x,
          y: player.y,
          z: player.z,
        },
      };
      entries.set(player.id, entry);
    }
    const incoming = player.move;
    const key = incoming ? `${incoming.sequence}:${incoming.startTick}` : "";
    if (incoming && key !== entry.key) {
      entry.key = key;
      entry.next.push(incoming);
    }
    let completedAt = null;
    if (entry.move && tick >= entry.move.startTick + entry.move.durationTicks) {
      completedAt = entry.move.startTick + entry.move.durationTicks;
      entry.settled = entry.move.target;
      entry.move = null;
    }
    if (!entry.move && entry.next.length) {
      const next = entry.next.shift();
      if (next) {
        entry.move = {
          ...next,
          startPosition: entry.settled,
          startTick: completedAt === null
            ? tick + 2
            : Math.max(tick, completedAt),
        };
      }
    }
    const move = entry.move;
    if (move && tick < move.startTick + move.durationTicks) {
      const progress = (tick - move.startTick) / move.durationTicks;
      const tile = progress >= 0.75 ? move.target : move.origin;
      return { ...player, ...tile, move };
    }
    if (!move && !incoming) {
      entry.settled = { x: player.x, y: player.y, z: player.z };
    }
    return { ...player, ...entry.settled, move: null };
  }

  return { playerAt, reset: () => entries.clear() };
}
