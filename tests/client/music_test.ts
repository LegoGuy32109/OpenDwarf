// Tests for the music player (ADR 0007).
import { assert, assertEquals } from "@std/assert";
import {
  createMusic,
  evictionPlan,
  MAX_FAILURES,
  parseIndex,
  pickTrack,
  PLAYS_KEY,
  RECENT_LIMIT,
} from "../../src/client/music.js";

const track = (key: string, tags: string[], hash = "aaaaaaaaaaaa") => ({
  key,
  hash,
  tags,
});

Deno.test("the index keeps entries with a key, a hash and tags, and ignores the rest", () => {
  const tracks = parseIndex({
    version: 1,
    extra: true,
    tracks: [
      {
        key: "music/A.ogg",
        hash: "1",
        tags: ["soft"],
        duration: 12,
        note: "x",
      },
      { hash: "2", tags: ["soft"] },
      { key: "music/B.ogg", tags: ["soft"] },
      { key: "music/C.ogg", hash: "3" },
      { key: "music/D.ogg", hash: "4", tags: "soft" },
      { key: "music/E.ogg", hash: "5", tags: [] },
      { key: "music/F.ogg", hash: "6", tags: ["a", 7, ""], mystery: 1 },
      { key: "music/A.ogg", hash: "7", tags: ["dup"] },
      null,
      "text",
    ],
  });
  assertEquals(tracks, [
    { key: "music/A.ogg", hash: "1", tags: ["soft"], duration: 12 },
    { key: "music/F.ogg", hash: "6", tags: ["a"] },
  ]);
  assertEquals(parseIndex(null), []);
  assertEquals(parseIndex({ tracks: "no" }), []);
});

Deno.test("a mood picks only tracks that share a tag", () => {
  const tracks = [
    track("a", ["forest"]),
    track("b", ["battle"]),
    track("c", ["soft", "night"]),
  ];
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    seen.add(
      pickTrack(tracks, ["forest", "soft"], { random: Math.random })!.key,
    );
  }
  assertEquals([...seen].sort(), ["a", "c"]);
  assertEquals(pickTrack(tracks, ["dramatic"]), null);
  assertEquals(
    pickTrack(tracks, ["forest"], { exclude: new Set(["a"]) }),
    null,
  );
});

Deno.test("a track is never one of the last five played", () => {
  const tracks = Array.from({ length: 8 }, (_, i) => track(`t${i}`, ["x"]));
  const recent: string[] = [];
  for (let i = 0; i < 200; i++) {
    const picked = pickTrack(tracks, ["x"], { recent })!;
    assert(!recent.slice(-RECENT_LIMIT).includes(picked.key));
    recent.push(picked.key);
  }
});

Deno.test("a small index still plays: the window shrinks to what is left", () => {
  const two = [track("a", ["x"]), track("b", ["x"])];
  assertEquals(pickTrack(two, ["x"], { recent: ["a"] })!.key, "b");
  assertEquals(pickTrack(two, ["x"], { recent: ["b"] })!.key, "a");
  const one = [track("a", ["x"])];
  assertEquals(pickTrack(one, ["x"], { recent: ["a", "a"] })!.key, "a");
});

Deno.test("random chooses among the candidates", () => {
  const tracks = [track("a", ["x"]), track("b", ["x"]), track("c", ["x"])];
  assertEquals(pickTrack(tracks, ["x"], { random: () => 0 })!.key, "a");
  assertEquals(pickTrack(tracks, ["x"], { random: () => 0.5 })!.key, "b");
  assertEquals(pickTrack(tracks, ["x"], { random: () => 0.9999 })!.key, "c");
  assertEquals(pickTrack(tracks, ["x"], { random: () => 1 })!.key, "c");
});

Deno.test("the least recently played tracks go first when the cache is over its cap", () => {
  const entries = [
    { url: "a", bytes: 50, played: 300 },
    { url: "b", bytes: 50, played: 100 },
    { url: "c", bytes: 50, played: 200 },
    { url: "d", bytes: 50, played: 0 },
  ];
  assertEquals(evictionPlan(entries, 200), []);
  assertEquals(evictionPlan(entries, 150), ["d"]);
  assertEquals(evictionPlan(entries, 100), ["d", "b"]);
  assertEquals(evictionPlan(entries, 0), ["d", "b", "c", "a"]);
  assertEquals(evictionPlan(entries, 100, new Set(["d"])), ["b", "c"]);
});

// A fake world: a cache, a bucket that can fail, audio nodes that record calls.
class FakeCache {
  store = new Map<string, Blob | string>();
  match(url: string) {
    const kept = this.store.get(url);
    return Promise.resolve(kept === undefined ? undefined : new Response(kept));
  }
  put(url: string, response: Response) {
    return response.blob().then((blob) => void this.store.set(url, blob));
  }
  delete(url: string) {
    return Promise.resolve(this.store.delete(url));
  }
  keys() {
    return Promise.resolve([...this.store.keys()].map((url) => ({ url })));
  }
}

class FakeElement extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 100;
  paused = true;
  failsToPlay = false;
  play() {
    if (this.failsToPlay) return Promise.reject(new Error("decode"));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

function fakeParam() {
  return { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} };
}

function setup(
  tracks: ReturnType<typeof track>[],
  bad: string[] = [],
  extra: Record<string, unknown> = {},
) {
  const cache = new FakeCache();
  const requests: string[] = [];
  const elements: FakeElement[] = [];
  const { preset, ...rest } = extra;
  const storage = new Map<string, string>(
    Object.entries((preset ?? {}) as Record<string, string>),
  );
  const index = JSON.stringify({ version: 1, tracks });
  const music = createMusic({
    level: "50",
    crossfade: 0.001,
    random: () => 0,
    mediaUrl: (key: string, hash?: string) =>
      `https://shell.test/media/${key}${hash ? `?v=${hash}` : ""}`,
    fetch: ((url: string) => {
      requests.push(url);
      if (url.includes("/index/")) return Promise.resolve(new Response(index));
      if (bad.some((key) => url.includes(key))) {
        return Promise.resolve(new Response("no", { status: 404 }));
      }
      return Promise.resolve(new Response(new Blob(["x".repeat(10)])));
    }) as typeof fetch,
    caches: { open: () => Promise.resolve(cache) },
    storage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
    createContext: () => ({
      state: "running",
      currentTime: 0,
      destination: {},
      createGain: () => ({
        gain: fakeParam(),
        connect() {},
        disconnect() {},
      }),
      createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
    }),
    createElement: () => {
      const element = new FakeElement();
      elements.push(element);
      return element;
    },
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
    persist: () => Promise.resolve(true),
    ...rest,
  } as never);
  return { music, cache, requests, elements, storage };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const trackRequests = (requests: string[]) =>
  requests.filter((url) => url.includes("/media/music/"));

Deno.test("nothing plays before a gesture, and a gesture starts a track", async () => {
  const { music, elements } = setup([track("music/a.ogg", ["adventure"])]);
  music.start(["adventure"]);
  await settle();
  assertEquals(music.state().track, null);
  assertEquals(elements.length, 0);
  music.unlock();
  await settle();
  assertEquals(music.state().track, "music/a.ogg");
  assertEquals(music.state().status, "playing");
  assertEquals(elements[0].paused, false);
});

Deno.test("later gestures keep the playing track, so a held key does not skip", async () => {
  const { music, elements } = setup([
    track("music/a.ogg", ["adventure"]),
    track("music/b.ogg", ["adventure"]),
    track("music/c.ogg", ["adventure"]),
  ]);
  music.start(["adventure"]);
  music.unlock();
  await settle();
  const first = music.state().track;
  for (let i = 0; i < 5; i++) {
    music.unlock();
    await settle();
  }
  assertEquals(music.state().track, first);
  assertEquals(music.state().recent, [first]);
  assertEquals(elements.filter((element) => !element.paused).length, 1);
});

Deno.test("a failing track is skipped and the next one plays", async () => {
  const { music } = setup(
    [
      track("music/bad.ogg", ["adventure"]),
      track("music/good.ogg", ["adventure"]),
    ],
    ["bad.ogg"],
  );
  music.start(["adventure"]);
  music.unlock();
  await settle();
  const state = music.state();
  assertEquals(state.skipped, ["music/bad.ogg"]);
  assertEquals(state.track, "music/good.ogg");
  assertEquals(state.failures, 0);
});

Deno.test("a track that cannot decode is skipped too", async () => {
  const { music, elements } = setup(
    [
      track("music/a.ogg", ["adventure"]),
      track("music/b.ogg", ["adventure"]),
    ],
    [],
    {
      createElement: () => {
        const element = new FakeElement();
        element.failsToPlay = elements.length === 0;
        elements.push(element);
        return element;
      },
    },
  );
  music.start(["adventure"]);
  music.unlock();
  await settle();
  assertEquals(music.state().skipped, ["music/a.ogg"]);
  assertEquals(music.state().track, "music/b.ogg");
});

Deno.test("after three failures in a row the player stops until the next mood", async () => {
  const keys = ["a", "b", "c", "d"].map((name) => `music/${name}.ogg`);
  const { music, requests } = setup(
    keys.map((key) => track(key, ["adventure"])),
    ["music/a", "music/b", "music/c", "music/d"],
  );
  music.start(["adventure"]);
  music.unlock();
  await settle();
  assertEquals(music.state().failures, MAX_FAILURES);
  assertEquals(music.state().status, "stopped");
  assertEquals(trackRequests(requests).length, MAX_FAILURES);
  music.setMood(["adventure"]);
  await settle();
  assertEquals(trackRequests(requests).length, 2 * MAX_FAILURES - 0);
});

Deno.test("a downloaded track is cached by its full URL and a hit makes no request", async () => {
  const one = [track("music/a.ogg", ["adventure"], "h1")];
  const first = setup(one);
  first.music.start(["adventure"]);
  first.music.unlock();
  await settle();
  const url = "https://shell.test/media/music/a.ogg?v=h1";
  assert(first.cache.store.has(url));
  assertEquals(first.music.state().cachedTracks, 1);
  assertEquals(first.music.state().cachedBytes, 10);

  // A new page: same cache and storage, a bucket that must not be asked.
  const second = setup(one, [], {});
  second.cache.store = first.cache.store;
  for (const [key, value] of first.storage) second.storage.set(key, value);
  second.music.start(["adventure"]);
  second.music.unlock();
  await settle();
  assertEquals(second.music.state().track, "music/a.ogg");
  assertEquals(trackRequests(second.requests), []);
});

Deno.test("the index is kept for offline use", async () => {
  const world = setup([track("music/a.ogg", ["adventure"], "h1")]);
  world.music.start(["adventure"]);
  world.music.unlock();
  await settle();
  assert(world.cache.store.has("https://shell.test/media/index/music.v1.json"));
  const offline = setup([], [], {
    fetch: () => Promise.reject(new TypeError("offline")),
  });
  offline.cache.store = world.cache.store;
  offline.music.start(["adventure"]);
  offline.music.unlock();
  await settle();
  assertEquals(offline.music.state().track, "music/a.ogg");
});

Deno.test("the cache evicts the least recently played track at the cap", async () => {
  const keys = ["a", "b", "c"].map((name) => `music/${name}.ogg`);
  let clock = 1000;
  const url = (key: string) => `https://shell.test/media/${key}?v=h`;
  // Cached earlier: a was played at 5, b at 1 (the oldest).
  const world = setup(
    keys.map((key, i) => track(key, [i < 2 ? "other" : "adventure"], "h")),
    [],
    {
      capBytes: 25,
      now: () => clock++,
      random: () => 0,
      preset: {
        [PLAYS_KEY]: JSON.stringify({
          [url(keys[0])]: { played: 5, bytes: 10 },
          [url(keys[1])]: { played: 1, bytes: 10 },
        }),
      },
    },
  );
  world.cache.store.set(url(keys[0]), new Blob(["x".repeat(10)]));
  world.cache.store.set(url(keys[1]), new Blob(["x".repeat(10)]));
  world.music.start(["adventure"]);
  world.music.unlock();
  await settle();
  assertEquals(world.music.state().track, "music/c.ogg");
  assert(!world.cache.store.has(url(keys[1])), "b was the least recent");
  assert(world.cache.store.has(url(keys[0])));
  assert(world.cache.store.has(url(keys[2])));
  assertEquals(world.music.state().cachedBytes, 20);
});

Deno.test("setMood crossfades a track that no longer fits, and off silences", async () => {
  const world = setup([
    track("music/a.ogg", ["soft"]),
    track("music/b.ogg", ["battle"]),
  ]);
  world.music.start(["soft"]);
  world.music.unlock();
  await settle();
  assertEquals(world.music.state().track, "music/a.ogg");
  world.music.setMood(["battle"]);
  await settle();
  assertEquals(world.music.state().track, "music/b.ogg");
  assertEquals(world.music.state().mood, ["battle"]);
  world.music.setLevel("off");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assertEquals(world.music.state().track, null);
  assert(world.elements.every((element) => element.paused));
});

Deno.test("the next track starts downloading when the current one starts", async () => {
  const world = setup([
    track("music/a.ogg", ["x"]),
    track("music/b.ogg", ["x"]),
  ]);
  world.music.start(["x"]);
  world.music.unlock();
  await settle();
  assertEquals(world.music.state().track, "music/a.ogg");
  assertEquals(world.music.state().next, "music/b.ogg");
  assertEquals(trackRequests(world.requests).length, 2);
});

Deno.test("a disabled player does nothing", async () => {
  const world = setup([track("music/a.ogg", ["x"])], [], { enabled: false });
  world.music.start(["x"]);
  world.music.unlock();
  await settle();
  assertEquals(world.requests, []);
  assertEquals(world.music.state().track, null);
});
