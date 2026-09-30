// @ts-check

/** @typedef {{viewRevision:number,sightRevision:number,tick:number}} Stamp */

/** Coordinate reliable view updates with replaceable motion in one attempt. */
export function createRevisionOrder() {
  let viewRevision = -1;
  let sightRevision = -1;
  let stateTick = -1;
  let motionTick = -1;
  return {
    /** @param {Stamp} stamp */
    reliable(stamp) {
      if (
        stamp.viewRevision < viewRevision ||
        stamp.viewRevision === viewRevision &&
          stamp.sightRevision < sightRevision ||
        stamp.tick < stateTick
      ) return null;
      const viewChanged = stamp.viewRevision !== viewRevision;
      const sightChanged = viewChanged || stamp.sightRevision !== sightRevision;
      const preserveMotion = !viewChanged && stamp.tick < motionTick;
      viewRevision = stamp.viewRevision;
      sightRevision = stamp.sightRevision;
      stateTick = stamp.tick;
      motionTick = Math.max(motionTick, stamp.tick);
      return { viewChanged, sightChanged, preserveMotion };
    },
    /** @param {Stamp} stamp @returns {"apply"|"hold"|"drop"} */
    motion(stamp) {
      if (
        stamp.viewRevision < viewRevision ||
        stamp.viewRevision === viewRevision &&
          stamp.sightRevision < sightRevision ||
        stamp.tick <= motionTick
      ) return "drop";
      if (
        stamp.viewRevision > viewRevision || stamp.sightRevision > sightRevision
      ) {
        return "hold";
      }
      motionTick = stamp.tick;
      return "apply";
    },
    reset() {
      viewRevision =
        sightRevision =
        stateTick =
        motionTick =
          -1;
    },
  };
}
