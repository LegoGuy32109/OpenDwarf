export type Position = {
  x: number;
  y: number;
  z: number;
  moveSequence: number | null;
  opacity?: number;
  tick?: number;
  motion?: {
    startPosition: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    startTick: number;
    durationTicks: number;
  } | null;
};

export interface HostMotionSample {
  at: number;
  positions: Record<string, Position | null>;
  visuals: Record<string, Position | null>;
  stats: { connections: { playerId: string }[] };
}
export interface VisualDelta {
  id: string;
  observer: string;
  target: string;
  tiles: number;
  skewMs: number;
  expected: Position;
  observed: Position;
}

export function alignedPosition(position: Position, skewMs: number): Position {
  const motion = position.motion;
  if (!motion || position.tick === undefined) return position;
  const alpha = Math.max(
    0,
    Math.min(
      1,
      (position.tick + skewMs / 50 - motion.startTick) / motion.durationTicks,
    ),
  );
  return {
    ...position,
    x: motion.startPosition.x +
      (motion.target.x - motion.startPosition.x) * alpha,
    y: motion.startPosition.y +
      (motion.target.y - motion.startPosition.y) * alpha,
    z: motion.startPosition.z +
      (motion.target.z - motion.startPosition.z) * alpha,
  };
}

export function hostVisualDeltas(hostData: HostMotionSample): VisualDelta[] {
  const visualDeltas: VisualDelta[] = [];
  for (const connection of hostData.stats.connections) {
    const target = connection.playerId;
    const expected = hostData.positions[target];
    const observed = hostData.visuals[target];
    if (
      !expected || !observed || observed.opacity === 0 ||
      expected.moveSequence === null ||
      observed.moveSequence !== expected.moveSequence
    ) continue;
    visualDeltas.push({
      id: `host:${target}`,
      observer: "host",
      target,
      skewMs: 0,
      expected,
      observed,
      tiles: Math.hypot(
        expected.x - observed.x,
        expected.y - observed.y,
        expected.z - observed.z,
      ),
    });
  }
  return visualDeltas;
}

type Observer = {
  id: string;
  observed: { at: number; local: Position | null; host: Position | null };
};
export function observerDeltas(
  hostData: HostMotionSample,
  observers: Observer[],
) {
  const visualDeltas: VisualDelta[] = [];
  const localPredictionDeltas: { id: string; tiles: number; skewMs: number }[] =
    [];
  let skippedSkew = 0;
  for (const { id, observed } of observers) {
    const skewMs = observed.at - hostData.at;
    if (Math.abs(skewMs) > 200) {
      skippedSkew++;
      continue;
    }
    const hostExpected = hostData.positions.self;
    if (
      hostExpected && hostExpected.moveSequence !== null && observed.host &&
      observed.host.opacity !== 0 &&
      observed.host.moveSequence === hostExpected.moveSequence
    ) {
      const aligned = alignedPosition(hostExpected, skewMs);
      visualDeltas.push({
        id: `${id}:self`,
        observer: id,
        target: "self",
        skewMs,
        expected: aligned,
        observed: observed.host,
        tiles: Math.hypot(
          aligned.x - observed.host.x,
          aligned.y - observed.host.y,
          aligned.z - observed.host.z,
        ),
      });
    }
    const localExpected = hostData.positions[id];
    if (
      localExpected && localExpected.moveSequence !== null && observed.local &&
      observed.local.moveSequence === localExpected.moveSequence
    ) {
      const aligned = alignedPosition(localExpected, skewMs);
      localPredictionDeltas.push({
        id,
        skewMs,
        tiles: Math.hypot(
          aligned.x - observed.local.x,
          aligned.y - observed.local.y,
          aligned.z - observed.local.z,
        ),
      });
    }
  }
  return { visualDeltas, localPredictionDeltas, skippedSkew };
}

export interface MotionTraceFrame {
  at: number;
  positions: Record<string, { x: number; y: number; z: number }>;
}
const distance = (a: { x: number; y: number; z: number }, b: typeof a) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Compare authoritative samples and rendered positions on the same capture clock. */
export function analyzeObserverTrace<T extends number | null>(
  hostTrace: MotionTraceFrame[],
  observer: { id: string; frames: MotionTraceFrame[] },
  percentileOf: (values: number[], fraction: number) => T,
) {
  let matched = 0, pauses = 0, steps = 0, sampleGaps = 0;
  const rawLag: number[] = [];
  const presentationAlignedError: number[] = [];
  let cursor = 0;
  const compareFrame = (
    frame: typeof observer.frames[number],
    priorFrame: typeof frame,
    current: typeof hostTrace[number],
    previous: typeof current,
    delayed: typeof current,
    interval: number,
  ) => {
    for (const [id, position] of Object.entries(frame.positions)) {
      if (id === observer.id) continue;
      const last = priorFrame.positions[id];
      const expected = current?.positions[id];
      const priorExpected = previous?.positions[id];
      const delayedExpected = delayed?.positions[id];
      if (
        !last || !expected || !priorExpected ||
        Math.abs(current.at - frame.at) > 150
      ) continue;
      matched++;
      rawLag.push(distance(position, expected));
      if (delayedExpected) {
        presentationAlignedError.push(distance(position, delayedExpected));
      }
      const delta = distance(position, last);
      if (distance(expected, priorExpected) > .02 && delta < .002) pauses++;
      // Continuous walking is 2.8 tiles/s; steps over twice that speed are recorded.
      if (delta > Math.max(.15, interval / 1_000 * 2.8 * 2)) steps++;
    }
  };
  for (let i = 1; i < observer.frames.length; i++) {
    const frame = observer.frames[i];
    const priorFrame = observer.frames[i - 1];
    const interval = frame.at - priorFrame.at;
    if (interval > 200) {
      sampleGaps++;
      continue;
    }
    while (
      cursor + 1 < hostTrace.length && hostTrace[cursor + 1].at <= frame.at
    ) cursor++;
    const current = hostTrace[cursor];
    const previous = hostTrace[Math.max(0, cursor - 1)];
    let delayedIndex = cursor;
    while (delayedIndex > 0 && hostTrace[delayedIndex].at > frame.at - 150) {
      delayedIndex--;
    }
    const delayed = hostTrace[delayedIndex];
    compareFrame(frame, priorFrame, current, previous, delayed, interval);
  }
  return {
    observer: observer.id,
    matched,
    pauses,
    steps,
    sampleGaps,
    rawLagTilesP95: percentileOf(rawLag, .95),
    presentationAlignedErrorTilesP95: percentileOf(
      presentationAlignedError,
      .95,
    ),
  };
}
