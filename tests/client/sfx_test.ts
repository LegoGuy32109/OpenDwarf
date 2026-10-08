// Effects player tests (ADR 0008).
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  createSfx,
  distanceGain,
  FULL_GAIN_TILES,
  LATE_MS,
  matchSamples,
  MAX_SOUNDS,
  MUFFLE_GAIN,
  MUFFLE_HZ,
  parseEffectsLevel,
  parseSfxIndex,
  SOUND_GAIN,
  SOUND_RATE,
  STEP_RATE,
} from "../../src/client/sfx.js";
import { SOUND_RANGE } from "../../src/shared/sound.js";

const sample = (key: string, tags: string[]) => ({ key, hash: "aaaa", tags });

/** A minimal AudioContext that records what plays. */
class FakeSource {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  startedAt: number | null = null;
  stopped = false;
  onended: (() => void) | null = null;
  connect() {}
  disconnect() {}
  start(when: number) {
    this.startedAt = when;
  }
  stop() {
    this.stopped = true;
    this.onended?.();
  }
}
class FakeContext {
  state = "running";
  currentTime = 10;
  destination = {};
  sources: FakeSource[] = [];
  gains: { gain: { value: number } }[] = [];
  filters: { type: string; frequency: { value: number } }[] = [];
  createGain() {
    const node = { gain: { value: 1 }, connect() {}, disconnect() {} };
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBiquadFilter() {
    const node = {
      type: "",
      frequency: { value: 0 },
      connect() {},
      disconnect() {},
    };
    this.filters.push(node);
    return node;
  }
  decodeAudioData(bytes: ArrayBuffer) {
    return Promise.resolve({ bytes });
  }
  resume() {}
  suspend() {}
}

const INDEX = {
  version: 1,
  samples: [
    { key: "sfx/a.ogg", hash: "h1", tags: ["step", "walk", "stone"] },
    { key: "sfx/b.ogg", hash: "h2", tags: ["step", "walk"] },
    { key: "sfx/c.ogg", hash: "h3", tags: ["step", "walk"] },
    { key: "sfx/d.ogg", hash: "h4", tags: ["ui", "open"] },
    { key: "sfx/gone.ogg", hash: "h5", tags: ["ui", "open"] },
  ],
};

/** A player with the fake context, a fake network, and everything decoded. */
async function player(
  options: { level?: "off" | "25" | "50" | "75" | "100"; index?: unknown } = {},
) {
  const context = new FakeContext();
  const fetched: string[] = [];
  let clock = 1000;
  const sfx = createSfx({
    level: options.level ?? "100",
    createContext: () => context as unknown as AudioContext,
    mediaUrl: (key, hash) => `/media/${key}${hash ? `?v=${hash}` : ""}`,
    caches: undefined,
    now: () => clock,
    random: () => 0,
    fetch: ((url: string) => {
      fetched.push(url);
      if (url.includes("index/")) {
        return Promise.resolve(Response.json(options.index ?? INDEX));
      }
      if (url.includes("gone")) {
        return Promise.resolve(new Response("", { status: 404 }));
      }
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
    }) as typeof fetch,
  });
  sfx.start();
  sfx.unlock();
  for (let i = 0; i < 50 && sfx.state().status !== "ready"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return {
    sfx,
    context,
    fetched,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

Deno.test("the index keeps entries with a key, a hash and tags, and ignores the rest", () => {
  const samples = parseSfxIndex({
    version: 1,
    extra: 1,
    samples: [
      { key: "a", hash: "1", tags: ["x"], note: "n", mystery: true },
      { hash: "2", tags: ["x"] },
      { key: "b", tags: ["x"] },
      { key: "c", hash: "3" },
      { key: "d", hash: "4", tags: [] },
      { key: "e", hash: "5", tags: ["x", 3, ""] },
      { key: "a", hash: "6", tags: ["dup"] },
      null,
    ],
  });
  assertEquals(samples, [
    { key: "a", hash: "1", tags: ["x"], note: "n" },
    { key: "e", hash: "5", tags: ["x"] },
  ]);
  assertEquals(parseSfxIndex(null), []);
  assertEquals(parseSfxIndex({ samples: "no" }), []);
});

Deno.test("the effects level falls back to 75", () => {
  assertEquals(parseEffectsLevel("25"), "25");
  assertEquals(parseEffectsLevel("loud"), "75");
  assertEquals(parseEffectsLevel(null), "75");
});

Deno.test("a sample matches with every tag, else the last tag drops", () => {
  const list = [
    sample("a", ["step", "walk", "stone"]),
    sample("b", ["step", "walk"]),
    sample("c", ["step", "run"]),
  ];
  assertEquals(
    matchSamples(list, ["step", "walk", "stone"]).map((s) => s.key),
    ["a"],
  );
  assertEquals(
    matchSamples(list, ["step", "walk", "iron ore"]).map((s) => s.key),
    ["a", "b"],
  );
  assertEquals(
    matchSamples(list, ["step", "run", "iron ore"]).map((s) => s.key),
    ["c"],
  );
  assertEquals(
    matchSamples(list, ["step", "sneak"]).map((s) => s.key),
    ["a", "b", "c"],
  );
  assertEquals(matchSamples(list, ["mine", "hit"]), []);
  assertEquals(matchSamples(list, []), []);
});

Deno.test("a sample that fails to download is skipped, and the rest play", async () => {
  const { sfx } = await player();
  assertEquals(sfx.state().samples, 5);
  assertEquals(sfx.state().loaded, 4);
  sfx.setRandom(() => 0.99);
  sfx.play(["ui", "open"]);
  assertEquals(sfx.log.map((entry) => entry.key), ["sfx/d.ogg"]);
});

Deno.test("a play never repeats the sample last played for the same tags", async () => {
  const { sfx } = await player();
  for (let i = 0; i < 12; i++) {
    sfx.setRandom(() => (i % 2 ? 0.99 : 0));
    sfx.play(["step", "walk"]);
  }
  const keys = sfx.log.map((entry) => entry.key);
  for (let i = 1; i < keys.length; i++) assert(keys[i] !== keys[i - 1]);
  // A different tag list keeps its own memory.
  sfx.play(["ui", "open"]);
  sfx.play(["ui", "open"]);
  assertEquals(sfx.log.at(-1)?.key, "sfx/d.ogg");
});

Deno.test("the pitch is 0.85 to 1.15 for steps and 0.9 to 1.1 for the rest", async () => {
  const { sfx } = await player();
  for (
    const [value, step, other] of [[0, 0.85, 0.9], [0.5, 1, 1], [
      0.99,
      1.15,
      1.1,
    ]]
  ) {
    sfx.setRandom(() => value);
    sfx.play(["step", "walk"]);
    sfx.play(["ui", "open"]);
    assertAlmostEquals(sfx.log.at(-2)!.rate, step, 0.01);
    assertAlmostEquals(sfx.log.at(-1)!.rate, other, 0.01);
  }
  assertEquals(STEP_RATE, [0.85, 1.15]);
  assertEquals(SOUND_RATE, [0.9, 1.1]);
});

Deno.test("the gain scales by a random 0.8 to 1.0", async () => {
  const { sfx } = await player();
  sfx.setRandom(() => 0);
  sfx.play(["ui", "open"]);
  sfx.setRandom(() => 0.999);
  sfx.play(["ui", "open"]);
  assertAlmostEquals(sfx.log[0].gain, SOUND_GAIN[0], 1e-6);
  assertAlmostEquals(sfx.log[1].gain, SOUND_GAIN[1], 0.001);
});

Deno.test("gain is full to 2 tiles and falls to silence at 12, horizontally", async () => {
  assertEquals(distanceGain(0), 1);
  assertEquals(distanceGain(FULL_GAIN_TILES), 1);
  assertAlmostEquals(distanceGain(7), 0.5, 1e-9);
  assertEquals(distanceGain(SOUND_RANGE), 0);
  assertEquals(distanceGain(40), 0);

  const { sfx } = await player();
  sfx.setListener({ x: 10, y: 10, z: 0 });
  sfx.play(["ui", "open"], { x: 10, y: 17, z: 3 });
  assertAlmostEquals(sfx.log[0].gain, 0.8 * 0.5, 1e-6);
  sfx.play(["ui", "open"], { x: 10, y: 22, z: 0 });
  assertEquals(sfx.log.length, 1, "silent at the range: nothing plays");
  sfx.play(["ui", "open"]);
  assertAlmostEquals(sfx.log[1].gain, 0.8, 1e-6, "no position: full gain");
});

Deno.test("a muffled sound has a 600 Hz low-pass and 60% gain", async () => {
  const { sfx, context } = await player();
  sfx.play(["ui", "open"], { muffled: true });
  assertEquals(sfx.log[0].muffled, true);
  assertAlmostEquals(sfx.log[0].gain, 0.8 * MUFFLE_GAIN, 1e-6);
  assertEquals(context.filters.length, 1);
  assertEquals(context.filters[0].type, "lowpass");
  assertEquals(context.filters[0].frequency.value, MUFFLE_HZ);
  sfx.play(["ui", "open"]);
  assertEquals(context.filters.length, 1);
});

Deno.test("`at` delays the start, and a play more than 500 ms late is dropped", async () => {
  const { sfx, context, now } = await player();
  sfx.play(["ui", "open"], { at: now() + 200 });
  assertAlmostEquals(context.sources[0].startedAt!, 10.2, 1e-9);
  sfx.play(["ui", "open"], { at: now() - LATE_MS });
  assertEquals(context.sources[1].startedAt, 10, "just on time starts now");
  sfx.play(["ui", "open"], { at: now() - LATE_MS - 1 });
  assertEquals(sfx.log.length, 2);
  assertEquals(context.sources.length, 2);
});

Deno.test("at most 16 sounds play, and a new one replaces the quietest", async () => {
  const { sfx, context } = await player();
  sfx.setListener({ x: 0, y: 0, z: 0 });
  // Distances 3..18 tiles: the farther, the quieter; 17 and 18 are silent.
  for (let i = 0; i < MAX_SOUNDS; i++) {
    sfx.play(["ui", "open"], { x: 2.5 + i * 0.5, y: 0, z: 0 });
  }
  assertEquals(sfx.state().playing, MAX_SOUNDS);
  const quietest = context.sources[MAX_SOUNDS - 1];
  sfx.play(["ui", "open"], { x: 2, y: 0, z: 0 });
  assertEquals(sfx.state().playing, MAX_SOUNDS);
  assert(quietest.stopped);
  assertEquals(context.sources.filter((s) => s.stopped).length, 1);
  // A sound quieter than all of them is dropped.
  sfx.play(["ui", "open"], { x: 11.9, y: 0, z: 0 });
  assertEquals(context.sources.length, MAX_SOUNDS + 1);
  assertEquals(sfx.state().playing, MAX_SOUNDS);
});

Deno.test("an ended sound frees its slot", async () => {
  const { sfx, context } = await player();
  sfx.play(["ui", "open"]);
  assertEquals(sfx.state().playing, 1);
  context.sources[0].onended?.();
  assertEquals(sfx.state().playing, 0);
});

Deno.test("off downloads and plays nothing, and turning it on loads the samples", async () => {
  const { sfx, fetched, context } = await player({ level: "off" });
  assertEquals(fetched, []);
  sfx.play(["ui", "open"]);
  assertEquals(context.sources.length, 0);
  assertEquals(sfx.line(), "Effects off");
  sfx.setLevel("50");
  for (let i = 0; i < 50 && sfx.state().loaded < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assertEquals(sfx.state().loaded, 4);
  sfx.play(["ui", "open"]);
  assertEquals(sfx.log.length, 1);
  assertEquals(sfx.line(), "Effects 4/5 samples  1 playing");
});

Deno.test("a disabled player does nothing at all", () => {
  const fetched: string[] = [];
  const sfx = createSfx({
    enabled: false,
    fetch: ((url: string) => {
      fetched.push(url);
      return Promise.reject(new Error("no"));
    }) as typeof fetch,
    createContext: () => {
      throw new Error("no context");
    },
  });
  sfx.start();
  sfx.unlock();
  sfx.play(["ui", "open"]);
  assertEquals(fetched, []);
  assertEquals(sfx.state().status, "off");
});

Deno.test("nothing plays while the context is suspended, so a hidden tab queues no burst", async () => {
  const { sfx, context } = await player();
  context.state = "suspended";
  sfx.play(["ui", "open"]);
  assertEquals(context.sources.length, 0);
  context.state = "running";
  sfx.play(["ui", "open"]);
  assertEquals(context.sources.length, 1);
});

Deno.test("a volume change keeps the loaded samples and fetches nothing", async () => {
  const { sfx, fetched } = await player();
  const before = fetched.length;
  sfx.setLevel("50");
  sfx.setLevel("25");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(fetched.length, before);
  assertEquals(sfx.state().status, "ready");
});
