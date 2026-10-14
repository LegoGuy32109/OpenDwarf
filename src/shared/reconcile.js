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

/** @param {Player} existing @param {Player} incoming */
function keepPosition(existing, incoming) {
  return {
    ...incoming,
    x: existing.x,
    y: existing.y,
    z: existing.z,
    move: existing.move,
  };
}

/** @param {Player} existing @param {Player} incoming */
function matchingStep(existing, incoming) {
  if (sameMove(existing.move, incoming.move)) return true;
  if (!existing.move && !incoming.move) return sameTile(existing, incoming);
  if (existing.move && !incoming.move) {
    return sameTile(existing.move.target, incoming);
  }
  return !existing.move && !!incoming.move &&
    sameTile(existing, incoming.move.target);
}

/** @param {Player} player */
function idle(player) {
  return !player.move && Math.hypot(player.vx ?? 0, player.vy ?? 0) < 0.015;
}

/** @param {Player} existing @param {Player} incoming */
function keepFreePrediction(existing, incoming) {
  const gap = Math.hypot(existing.x - incoming.x, existing.y - incoming.y);
  if (
    idle(existing) && idle(incoming) &&
    (gap > 0.000001 || existing.z !== incoming.z)
  ) return false;
  const sameElevation = existing.z === incoming.z ||
    (existing.move && incoming.move &&
      existing.move.target.z === incoming.move.target.z);
  return gap < 0.4 && sameElevation;
}

/** @param {Player} existing @param {Player} incoming @param {number} latest */
function pendingFollowsHost(existing, incoming, latest) {
  const hostTarget = incoming.move?.target ?? incoming;
  const predictedOrigin = existing.move?.origin ?? existing;
  return (
    existing.move?.sequence === latest && sameTile(predictedOrigin, hostTarget)
  );
}

/** @param {Player} existing @param {Player} incoming @param {number} acknowledged @param {number} latest */
function keepLocalStep(existing, incoming, acknowledged, latest) {
  if (matchingStep(existing, incoming)) return true;
  if (latest !== acknowledged + 1) return false;
  if (pendingFollowsHost(existing, incoming, latest)) return true;
  return !existing.move && !incoming.move && existing.z === incoming.z &&
    Math.abs(existing.x - incoming.x) <= 1 &&
    Math.abs(existing.y - incoming.y) <= 1;
}

/** @param {Player} existing @param {Player} incoming @param {number} tick */
function keepRemoteStep(existing, incoming, tick) {
  if (sameMove(existing.move, incoming.move)) return true;
  return !!existing.move && !incoming.move &&
    sameTile(existing.move.target, incoming) &&
    tick < existing.move.startTick + existing.move.durationTicks;
}

/** @typedef {{localTick:number,hostTick:number,acknowledged:number,latest:number,localId:string}} MergeClock */
/** @param {Player|undefined} existing @param {Player} incoming @param {MergeClock} clock @param {boolean} local */
function mergePlayer(existing, incoming, clock, local) {
  if (incoming.free) return mergeFreePlayer(existing, incoming, local);
  if (!existing) {
    return {
      player: atLocalTick(incoming, clock.hostTick, clock.localTick),
      corrected: false,
    };
  }
  if (local) {
    if (keepLocalStep(existing, incoming, clock.acknowledged, clock.latest)) {
      return { player: keepPosition(existing, incoming), corrected: false };
    }
    return {
      player: atLocalTick(incoming, clock.hostTick, clock.localTick),
      corrected: true,
    };
  }
  if (sameViewMotion(existing.viewMotion, incoming.viewMotion)) {
    return {
      player: { ...incoming, viewMotion: existing.viewMotion },
      corrected: false,
    };
  }
  const player = keepRemoteStep(existing, incoming, clock.localTick)
    ? keepPosition(existing, incoming)
    : atLocalTick(incoming, clock.hostTick, clock.localTick);
  return { player, corrected: false };
}

/** @param {Player|undefined} existing @param {Player} incoming @param {boolean} local */
function mergeFreePlayer(existing, incoming, local) {
  if (!local || !existing?.free) return { player: incoming, corrected: false };
  if (!keepFreePrediction(existing, incoming)) {
    return { player: incoming, corrected: true };
  }
  return {
    player: {
      ...keepPosition(existing, incoming),
      vx: existing.vx,
      vy: existing.vy,
      previousX: existing.previousX,
      previousY: existing.previousY,
    },
    corrected: false,
  };
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
  const clock = {
    localTick: local.tick,
    hostTick: snapshot.tick,
    acknowledged: acknowledgedSequence,
    latest: latestLocalSequence,
    localId,
  };
  let corrected = false;
  for (const [id, incoming] of Object.entries(snapshot.players)) {
    const merged = mergePlayer(
      local.players[id],
      incoming,
      clock,
      id === localId,
    );
    players[id] = merged.player;
    corrected ||= merged.corrected;
  }
  local.players = players;
  return { corrected };
}
