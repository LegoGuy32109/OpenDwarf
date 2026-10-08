// Shared music cue tests (ADR 0009): the conductor and the guest that follows.
import { assert, assertEquals } from "@std/assert";
import { createMusic, DRIFT_LIMIT } from "../../src/client/music.js";

type Entry = { key: string; hash: string; tags: string[]; duration?: number };
const entry = (name: string, duration = 100): Entry => ({
  key: `music/${name}.ogg`,
  hash: "aaaaaaaaaaaa",
  tags: ["adventure"],
  duration,
});

class FakeCache {
  store = new Map<string, Blob>();
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

/** The music decks are reused (primed on the first gesture for iOS): find the one playing a track. */
const playing = (elements: FakeElement[]) =>
  elements.filter((element) => !element.paused);
const withTrack = (elements: FakeElement[]) =>
  elements.filter((element) => element.src.startsWith("blob:"));

class FakeElement extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 100;
  paused = true;
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

function setup(
  tracks: Entry[],
  level: "off" | "50" = "50",
  extra: Record<string, unknown> = {},
) {
  const requests: string[] = [];
  const elements: FakeElement[] = [];
  const cache = new FakeCache();
  const index = JSON.stringify({ version: 1, tracks });
  const music = createMusic({
    level,
    crossfade: 0.001,
    random: () => 0,
    mediaUrl: (key: string, hash?: string) =>
      `https://shell.test/media/${key}${hash ? `?v=${hash}` : ""}`,
    fetch: ((url: string) => {
      requests.push(url);
      if (url.includes("/index/")) return Promise.resolve(new Response(index));
      return Promise.resolve(new Response(new Blob(["x".repeat(10)])));
    }) as typeof fetch,
    caches: { open: () => Promise.resolve(cache) },
    storage: { getItem: () => null, setItem: () => {} },
    createContext: () => ({
      state: "running",
      currentTime: 0,
      destination: {},
      createGain: () => ({
        gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
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
    ...extra,
  } as never);
  return { music, requests, elements };
}

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const trackRequests = (requests: string[]) =>
  requests.filter((url) => url.includes("/media/music/"));
const cue = (name: string) => ({
  key: `music/${name}.ogg`,
  hash: "bbbbbbbbbbbb",
});

Deno.test("the conductor keeps picking and advances by duration with Music Off", async () => {
  // Each track lasts 0.06 s; the next one starts a crossfade (1 ms) before that.
  const { music, requests, elements } = setup(
    [entry("a", 0.06), entry("b", 0.06)],
    "off",
  );
  const started: string[] = [];
  music.onTrackStart((track) => started.push(track.key));
  music.start(["adventure"]);
  music.unlock();
  await settle(5);
  assertEquals(started.length, 1);
  await settle(200);
  assert(started.length >= 3, `only ${started.length} tracks started`);
  // The last five are not repeated, but a two-track index alternates.
  assertEquals(started[0] === started[1], false);
  assertEquals(trackRequests(requests), []);
  assertEquals(withTrack(elements).length, 0);
  assertEquals(playing(elements).length, 0);
  assertEquals(music.state().role, "host");
  assert(music.line().includes("(host)"), music.line());
  assertEquals(music.state().cue, started[started.length - 1]);
  music.setLevel("off");
  music.follow(null, 0);
});

Deno.test("a host with Music on reports each track it plays, and turning it on resumes the counted track", async () => {
  let clock = 1_000_000;
  const { music, elements } = setup([entry("a", 100)], "off", {
    now: () => clock,
  });
  const started: string[] = [];
  music.onTrackStart((track) => started.push(track.key));
  music.start(["adventure"]);
  music.unlock();
  await settle();
  assertEquals(started, ["music/a.ogg"]);
  clock += 30_000;
  music.setLevel("50");
  await settle();
  // The same track plays from where the conductor counted to; no new cue.
  assertEquals(started, ["music/a.ogg"]);
  assertEquals(playing(elements).length, 1);
  assertEquals(playing(elements)[0].currentTime, 30);
  assertEquals(music.state().track, "music/a.ogg");
  // Off again: the conductor keeps counting the same track.
  music.setLevel("off");
  assertEquals(playing(elements).length, 0);
  assertEquals(music.state().cue, "music/a.ogg");
  assertEquals(started, ["music/a.ogg"]);
  clock += 1000;
  music.setLevel("50");
  await settle();
  assertEquals(playing(elements)[0].currentTime, 31);
});

Deno.test("follow starts the cued track at the offset", async () => {
  const { music, elements, requests } = setup([entry("a"), entry("b")]);
  music.start(["adventure"]);
  music.unlock();
  await settle();
  music.follow(cue("b"), 12.5);
  await settle();
  assertEquals(music.state().track, "music/b.ogg");
  assertEquals(music.state().role, "cued");
  assert(music.line().includes("b (cued)"), music.line());
  // The local track may still be fading out on the other deck.
  const element = playing(elements).find((candidate) =>
    candidate.currentTime >= 12.5 && candidate.currentTime < 13
  );
  assert(element, "no deck plays b from 12.5 s");
  // The cue's hash is the one downloaded.
  assert(requests.some((url) => url.endsWith("music/b.ogg?v=bbbbbbbbbbbb")));
});

Deno.test("a guest stops picking its own tracks while it follows", async () => {
  const { music, elements } = setup(
    [entry("a", 0.04), entry("b", 0.04)],
    "50",
  );
  music.start(["adventure"]);
  music.unlock();
  await settle();
  music.follow(cue("a"), 0);
  await settle();
  const count = elements.length;
  music.setMood(["adventure"]);
  await settle(150);
  assertEquals(elements.length, count);
  assertEquals(music.state().track, "music/a.ogg");
});

Deno.test("a new cue crossfades from the previous track", async () => {
  const { music, elements } = setup([entry("a"), entry("b")], "50", {
    crossfade: 0.1,
  });
  music.start(["adventure"]);
  music.unlock();
  await settle();
  music.follow(cue("a"), 1);
  await settle();
  assertEquals(music.state().track, "music/a.ogg");
  // The cued a started at 1 s; a local track may still be fading on the other deck.
  const first = playing(elements).find((candidate) =>
    candidate.currentTime >= 1 && candidate.currentTime < 1.5
  )!;
  music.follow(cue("b"), 0);
  await settle(5);
  // Both play while the crossfade runs, then the old one is torn down.
  assertEquals(music.state().track, "music/b.ogg");
  assertEquals(first.paused, false);
  await settle(300);
  assertEquals(first.paused, true);
  assertEquals(playing(elements).length, 1);
});

Deno.test("a heartbeat for the same track skips a drifted guest to the host's position", async () => {
  let clock = 1_000_000;
  const { music, elements } = setup([entry("a"), entry("b")], "50", {
    now: () => clock,
  });
  music.start(["adventure"]);
  music.unlock();
  await settle();
  music.follow(cue("a"), 10);
  await settle();
  const deck = playing(elements).find((element) =>
    element.src.startsWith("blob:") && element.currentTime === 10
  )!;
  assert(deck, "no deck plays a from 10 s");
  const count = elements.length;
  // The phone started late: its deck is a second behind the host.
  clock += 5000;
  deck.currentTime = 14;
  music.follow(cue("a"), 15);
  assertEquals(deck.currentTime, 15);
  assertEquals(music.state().resyncs, 1);
  // A drift inside the limit is left alone: no audible skip.
  clock += 4000;
  deck.currentTime = 19 + DRIFT_LIMIT / 2;
  music.follow(cue("a"), 19);
  assertEquals(deck.currentTime, 19 + DRIFT_LIMIT / 2);
  assertEquals(music.state().resyncs, 1);
  // The heartbeat never restarts the track.
  await settle();
  assertEquals(elements.length, count);
  assertEquals(deck.paused, false);
  assertEquals(music.state().track, "music/a.ogg");
});

Deno.test("the conductor reports where it is in its track", async () => {
  let clock = 2_000_000;
  const { music, elements } = setup([entry("a", 100)], "off", {
    now: () => clock,
  });
  assertEquals(music.position(), null);
  music.onTrackStart(() => {});
  music.start(["adventure"]);
  music.unlock();
  await settle();
  // Music Off: the silent count.
  clock += 12_000;
  assertEquals(music.position(), { key: "music/a.ogg", seconds: 12 });
  // Music on: the playing deck's own time.
  music.setLevel("50");
  await settle();
  const deck = playing(elements)[0];
  deck.currentTime = 12.5;
  assertEquals(music.position(), { key: "music/a.ogg", seconds: 12.5 });
});

Deno.test("a cue for a track the index does not list keeps the current track", async () => {
  const { music, requests } = setup([entry("a"), entry("b")]);
  music.start(["adventure"]);
  music.unlock();
  await settle();
  music.follow(cue("a"), 0);
  await settle();
  const before = trackRequests(requests).length;
  music.follow(cue("nowhere"), 0);
  await settle();
  assertEquals(music.state().track, "music/a.ogg");
  assertEquals(trackRequests(requests).length, before);
});

Deno.test("a cue whose download fails keeps the current track", async () => {
  const failing = setup([entry("a"), entry("b")], "50", {
    fetch: ((url: string) => {
      if (url.includes("/index/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ tracks: [entry("a"), entry("b")] })),
        );
      }
      return Promise.resolve(
        url.includes("music/b.ogg")
          ? new Response("no", { status: 404 })
          : new Response(new Blob(["x"])),
      );
    }) as typeof fetch,
  });
  const { music } = failing;
  music.start(["adventure"]);
  music.unlock();
  await settle();
  music.follow(cue("a"), 0);
  await settle();
  music.follow(cue("b"), 0);
  await settle();
  assertEquals(music.state().track, "music/a.ogg");
  assertEquals(music.state().status, "playing");
});

Deno.test("a guest with Music Off downloads no track and starts at the current offset when turned on", async () => {
  let clock = 5_000_000;
  const { music, requests, elements } = setup(
    [entry("a"), entry("b")],
    "off",
    { now: () => clock },
  );
  music.start(["adventure"]);
  music.unlock();
  await settle();
  music.follow(cue("a"), 10);
  await settle();
  assertEquals(trackRequests(requests), []);
  assertEquals(withTrack(elements).length, 0);
  clock += 20_000;
  music.setLevel("50");
  await settle();
  assertEquals(music.state().track, "music/a.ogg");
  assertEquals(playing(elements)[0].currentTime, 30);
});

Deno.test("follow(null) goes back to picking locally", async () => {
  const { music } = setup([entry("a"), entry("b")]);
  music.start(["adventure"]);
  music.follow(cue("b"), 0);
  music.unlock();
  await settle();
  assertEquals(music.state().track, "music/b.ogg");
  music.follow(null, 0);
  assertEquals(music.state().role, "local");
});

Deno.test("with music disabled a guest follows nothing", async () => {
  const { music, requests } = setup([entry("a")], "50", { enabled: false });
  music.start(["adventure"]);
  music.unlock();
  music.follow(cue("a"), 0);
  await settle();
  assertEquals(requests, []);
});
