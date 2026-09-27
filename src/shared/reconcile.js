// @ts-check

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./world.js').Move} Move */

/** @param {{x:number,y:number,z:number}} a @param {{x:number,y:number,z:number}} b */
function sameTile(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** @param {Move|null} a @param {Move|null} b */
function sameMove(a, b) {
  return !!a && !!b && a.sequence === b.sequence &&
    a.target.x === b.target.x && a.target.y === b.target.y &&
    a.target.z === b.target.z;
}

/** Translate a host animation to the local simulation tick without changing its progress. */
/** @param {Player} player @param {number} hostTick @param {number} localTick */
function atLocalTick(player, hostTick, localTick) {
  const move = player.move
    ? {
      ...player.move,
      startTick: localTick - (hostTick - player.move.startTick),
    }
    : null;
  return { ...player, move };
}

/** Keep a client's own confirmed animation and any input the host has not seen yet. */
/** @param {World} local @param {World} snapshot @param {number} acknowledgedSequence @param {number} latestLocalSequence */
export function mergeSnapshot(
  local,
  snapshot,
  acknowledgedSequence,
  latestLocalSequence,
) {
  /** @type {Record<string,Player>} */
  const players = {};
  let corrected = false;
  for (const [id, incoming] of Object.entries(snapshot.players)) {
    const existing = local.players[id];
    if (!existing) {
      players[id] = atLocalTick(incoming, snapshot.tick, local.tick);
      continue;
    }
    if (id === "admin") {
      const pending = latestLocalSequence > acknowledgedSequence;
      const matching = sameMove(existing.move, incoming.move) ||
        (!existing.move && !incoming.move && sameTile(existing, incoming)) ||
        (existing.move && !incoming.move &&
          sameTile(existing.move.target, incoming)) ||
        (!existing.move && incoming.move &&
          sameTile(existing, incoming.move.target));
      if (pending || matching) {
        players[id] = {
          ...incoming,
          x: existing.x,
          y: existing.y,
          z: existing.z,
          move: existing.move,
        };
        continue;
      }
      corrected = true;
    } else if (
      sameMove(existing.move, incoming.move) ||
      (existing.move && !incoming.move &&
        sameTile(existing.move.target, incoming) &&
        local.tick < existing.move.startTick + existing.move.durationTicks)
    ) {
      players[id] = {
        ...incoming,
        x: existing.x,
        y: existing.y,
        z: existing.z,
        move: existing.move,
      };
      continue;
    }
    players[id] = atLocalTick(incoming, snapshot.tick, local.tick);
  }
  local.players = players;
  return { corrected };
}
