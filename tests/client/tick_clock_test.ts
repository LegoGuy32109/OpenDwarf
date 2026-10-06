import { assertEquals } from "@std/assert";
import {
  BACKGROUND_CATCH_UP_MS,
  catchUpMs,
  createTickClock,
  VISIBLE_CATCH_UP_MS,
} from "../../src/client/tick-clock.js";

class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor(public url: string) {
    FakeWorker.made.push(this);
  }
  terminate() {
    this.terminated = true;
  }
}

function fakeEnv(withWorker: boolean) {
  FakeWorker.made = [];
  const listeners = new Set<() => void>();
  const intervals = new Map<number, () => void>();
  let nextInterval = 1;
  const document = {
    hidden: false,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  const env = {
    document,
    Worker: withWorker ? FakeWorker : undefined,
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    Blob: class {},
    setInterval: (fn: () => void) => {
      intervals.set(nextInterval, fn);
      return nextInterval++;
    },
    clearInterval: (id: number) => intervals.delete(id),
  };
  const setHidden = (hidden: boolean) => {
    document.hidden = hidden;
    for (const fn of listeners) fn();
  };
  return { env, setHidden, intervals };
}

Deno.test("the clock starts when the tab hides and stops when it shows", () => {
  const { env, setHidden } = fakeEnv(true);
  let ticks = 0;
  const clock = createTickClock(() => ticks++, 50, env);
  assertEquals(clock.running, false);
  setHidden(true);
  assertEquals(clock.running, true);
  assertEquals(FakeWorker.made.length, 1);
  FakeWorker.made[0].onmessage!();
  FakeWorker.made[0].onmessage!();
  assertEquals(ticks, 2);
  setHidden(true);
  assertEquals(FakeWorker.made.length, 1);
  setHidden(false);
  assertEquals(clock.running, false);
  assertEquals(FakeWorker.made[0].terminated, true);
});

Deno.test("a tab that is already hidden starts the clock at once", () => {
  const { env } = fakeEnv(true);
  env.document.hidden = true;
  const clock = createTickClock(() => {}, 50, env);
  assertEquals(clock.running, true);
});

Deno.test("catch-up is 250 ms while visible and 2 s in the background", () => {
  assertEquals(catchUpMs(100, false), 100);
  assertEquals(catchUpMs(10_000, false), VISIBLE_CATCH_UP_MS);
  assertEquals(catchUpMs(1_500, true), 1_500);
  assertEquals(catchUpMs(60_000, true), BACKGROUND_CATCH_UP_MS);
  assertEquals(BACKGROUND_CATCH_UP_MS, 2000);
});

Deno.test("without Worker the clock falls back to setInterval", () => {
  const { env, setHidden, intervals } = fakeEnv(false);
  let ticks = 0;
  const clock = createTickClock(() => ticks++, 50, env);
  setHidden(true);
  assertEquals(clock.running, true);
  assertEquals(intervals.size, 1);
  for (const fn of intervals.values()) fn();
  assertEquals(ticks, 1);
  setHidden(false);
  assertEquals(intervals.size, 0);
});

Deno.test("a Worker error falls back to setInterval", () => {
  const { env, setHidden, intervals } = fakeEnv(true);
  createTickClock(() => {}, 50, env);
  setHidden(true);
  FakeWorker.made[0].onerror!();
  assertEquals(FakeWorker.made[0].terminated, true);
  assertEquals(intervals.size, 1);
});
