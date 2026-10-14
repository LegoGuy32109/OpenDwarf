import { assertEquals } from "@std/assert";
import {
  alignedPosition,
  analyzeObserverTrace,
  type HostMotionSample,
  hostVisualDeltas,
  type MotionTraceFrame,
  observerDeltas,
  type Position,
} from "../../scripts/motion-evidence.ts";

function position(x = 2, sequence: number | null = 1): Position {
  return { x, y: 3, z: 0, moveSequence: sequence };
}
function host(): HostMotionSample {
  return {
    at: 1000,
    positions: { self: position(), guest: position(3) },
    visuals: { guest: position(2.5) },
    stats: { connections: [{ playerId: "guest" }] },
  };
}
Deno.test("motion evidence aligns a moving host to the observer timestamp", () => {
  const source = {
    ...position(),
    tick: 5,
    motion: {
      startTick: 0,
      durationTicks: 10,
      startPosition: { x: 0, y: 0, z: 0 },
      target: { x: 10, y: 10, z: 2 },
    },
  };
  assertEquals(alignedPosition(source, 50), { ...source, x: 6, y: 6, z: 1.2 });
  assertEquals(alignedPosition(source, -1000), { ...source, x: 0, y: 0, z: 0 });
  assertEquals(alignedPosition(source, 1000), {
    ...source,
    x: 10,
    y: 10,
    z: 2,
  });
  assertEquals(alignedPosition(position(), 0), position());
  assertEquals(alignedPosition({ ...source, tick: undefined }, 0), {
    ...source,
    tick: undefined,
  });
});
Deno.test("host motion evidence compares only visible matching movements", () => {
  const sample = host();
  assertEquals(hostVisualDeltas(sample).map((d) => d.tiles), [0.5]);
  for (
    const observed of [null, { ...position(), opacity: 0 }, position(2, 2)]
  ) {
    sample.visuals.guest = observed;
    assertEquals(hostVisualDeltas(sample), []);
  }
  sample.visuals.guest = position();
  for (const expected of [null, position(2, null)]) {
    sample.positions.guest = expected;
    assertEquals(hostVisualDeltas(sample), []);
  }
});
Deno.test("observer motion evidence fences skew and preserves local prediction regardless of opacity", () => {
  const sample = host();
  const observed = {
    at: 1050,
    host: position(1.5),
    local: { ...position(2), opacity: 0 },
  };
  const result = observerDeltas(sample, [{ id: "guest", observed }]);
  assertEquals(result.skippedSkew, 0);
  assertEquals(
    result.visualDeltas.map((d) => ({
      id: d.id,
      tiles: d.tiles,
      skewMs: d.skewMs,
    })),
    [{ id: "guest:self", tiles: 0.5, skewMs: 50 }],
  );
  assertEquals(result.localPredictionDeltas, [{
    id: "guest",
    skewMs: 50,
    tiles: 1,
  }]);
  assertEquals(
    observerDeltas(sample, [{
      id: "guest",
      observed: { ...observed, at: 1201 },
    }]).skippedSkew,
    1,
  );
  assertEquals(
    observerDeltas(sample, [{
      id: "guest",
      observed: { ...observed, at: 800 },
    }]).skippedSkew,
    0,
  );
});
Deno.test("observer evidence excludes stale, hidden, absent and idle remote records", () => {
  for (const remote of [null, { ...position(), opacity: 0 }, position(2, 2)]) {
    const result = observerDeltas(host(), [{
      id: "guest",
      observed: { at: 1000, host: remote, local: remote },
    }]);
    assertEquals(result.visualDeltas, []);
    if (remote?.moveSequence === 2 || remote === null) {
      assertEquals(result.localPredictionDeltas, []);
    }
  }
  for (const expected of [null, position(2, null)]) {
    const sample = host();
    sample.positions.self = sample.positions.guest = expected;
    const result = observerDeltas(sample, [{
      id: "guest",
      observed: { at: 1000, host: position(), local: position() },
    }]);
    assertEquals(result.visualDeltas, []);
    assertEquals(result.localPredictionDeltas, []);
  }
});

Deno.test("motion trace analysis reports pauses, jumps and delayed presentation error", () => {
  const at = (time: number, x: number) => ({
    at: time,
    positions: { remote: { x, y: 0, z: 0 }, viewer: { x: 99, y: 99, z: 0 } },
  });
  const authoritative = [at(0, 0), at(100, 1), at(150, 1.5), at(200, 2)];
  const rendered = [at(0, 0), at(100, 0), at(200, 2)];
  const report = analyzeObserverTrace(authoritative, {
    id: "viewer",
    frames: rendered,
  }, (values) => values[0] ?? null);
  assertEquals(report.matched, 2);
  assertEquals(report.pauses, 1);
  assertEquals(report.steps, 1);
  assertEquals(report.sampleGaps, 0);
  assertEquals(report.rawLagTilesP95, 1);
  assertEquals(report.presentationAlignedErrorTilesP95, 0);
});
Deno.test("motion trace analysis excludes stale captures, absent peers and large sampling gaps", () => {
  const point = { x: 0, y: 0, z: 0 };
  const frames: MotionTraceFrame[] = [
    { at: 0, positions: { remote: point } },
    { at: 100, positions: { remote: point } },
    { at: 400, positions: { remote: point } },
    { at: 500, positions: { missing: point } },
  ];
  const report = analyzeObserverTrace(
    [{ at: 0, positions: { remote: point } }],
    { id: "viewer", frames },
    () => null,
  );
  assertEquals(report.matched, 1);
  assertEquals(report.sampleGaps, 1);
  assertEquals(report.pauses, 0);
  assertEquals(report.steps, 0);
  assertEquals(
    analyzeObserverTrace([], { id: "viewer", frames }, () => null).matched,
    0,
  );
});
