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

/** @param {Player['viewMotion']} a @param {Player['viewMotion']} b */
function sameViewMotion(a, b) {
  return !!a && !!b && a.entering === b.entering &&
    a.sequence === b.sequence &&
    sameTile(a.from, b.from) && sameTile(a.to, b.to);
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
  const viewMotion = player.viewMotion
    ? {
      ...player.viewMotion,
      startTick: localTick - (hostTick - player.viewMotion.startTick),
    }
    : undefined;
  return { ...player, move, viewMotion };
}

/** Keep matching local animation, but accept the host's position when prediction diverges. */
/** @param {World} local @param {World} snapshot @param {number} acknowledgedSequence @param {number} latestLocalSequence @param {string} localId */
export function mergeSnapshot(
  local,
  snapshot,
  acknowledgedSequence,
  latestLocalSequence,
  localId,
) {
  /** @type {Record<string,Player>} */
  const players = {};
  let corrected = false;
  for (const [id, incoming] of Object.entries(snapshot.players)) {
    const existing = local.players[id];
    if (incoming.free) {
      if (id === localId && existing?.free) {
        const gap = Math.hypot(
          existing.x - incoming.x,
          existing.y - incoming.y,
        );
        const sameElevation = existing.z === incoming.z ||
          (existing.move && incoming.move &&
            existing.move.target.z === incoming.move.target.z);
        const bothIdle = !existing.move && !incoming.move &&
          Math.hypot(existing.vx ?? 0, existing.vy ?? 0) < 0.015 &&
          Math.hypot(incoming.vx ?? 0, incoming.vy ?? 0) < 0.015;
        if (bothIdle && (gap > 0.000001 || existing.z !== incoming.z)) {
          corrected = true;
          players[id] = incoming;
        } else if (gap < 0.4 && sameElevation) {
          players[id] = {
            ...incoming,
            x: existing.x,
            y: existing.y,
            z: existing.z,
            move: existing.move,
            vx: existing.vx,
            vy: existing.vy,
            previousX: existing.previousX,
            previousY: existing.previousY,
          };
        } else {
          corrected = true;
          players[id] = incoming;
        }
      } else players[id] = incoming;
      continue;
    }
    if (!existing) {
      players[id] = atLocalTick(incoming, snapshot.tick, local.tick);
      continue;
    }
    if (id === localId) {
      const matching = sameMove(existing.move, incoming.move) ||
        (!existing.move && !incoming.move && sameTile(existing, incoming)) ||
        (existing.move && !incoming.move &&
          sameTile(existing.move.target, incoming)) ||
        (!existing.move && incoming.move &&
          sameTile(existing, incoming.move.target));
      const onePending = latestLocalSequence === acknowledgedSequence + 1;
      const hostTarget = incoming.move?.target ?? incoming;
      const predictedOrigin = existing.move?.origin ?? existing;
      const pendingFollowsHost = onePending &&
        existing.move?.sequence === latestLocalSequence &&
        sameTile(predictedOrigin, hostTarget);
      const completedPendingStep = onePending && !existing.move &&
        !incoming.move && existing.z === incoming.z &&
        Math.abs(existing.x - incoming.x) <= 1 &&
        Math.abs(existing.y - incoming.y) <= 1;
      if (matching || pendingFollowsHost || completedPendingStep) {
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
      sameViewMotion(existing.viewMotion, incoming.viewMotion)
    ) {
      players[id] = { ...incoming, viewMotion: existing.viewMotion };
      continue;
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
  local.edge = snapshot.edge;
  local.chunks = snapshot.chunks;
  local.terrain = snapshot.terrain;
  return { corrected };
}
