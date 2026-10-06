// Chatter audio (ADR 0006): the gain rules, the player, and the synthesizer.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  createChatter,
  distanceGain,
  MAX_VOICES,
  MURMUR_CUTOFF_HZ,
  murmurText,
  parseVoicesLevel,
  VOICES_KEY,
  VOICES_VOLUME,
} from "../../src/client/chatter.js";
import { tableBuilds, vowelTables } from "../../src/client/voice.js";
import { speechSchedule, voiceFromId } from "../../src/shared/speech.js";

type Started = {
  offset: number;
  volume: number;
  stopped: boolean;
};

/** An audio context that records what plays and makes no sound. */
function fakeAudio() {
  const started: Started[] = [];
  const context = {
    sampleRate: 8000,
    currentTime: 0,
    state: "running",
    destination: {},
    resumed: 0,
    resume() {
      this.resumed++;
    },
    createBuffer(_channels: number, length: number) {
      return { length, getChannelData: () => new Float32Array(length) };
    },
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    },
    createBiquadFilter() {
      return { type: "", frequency: { value: 0 }, connect() {} };
    },
    createBufferSource() {
      let volume = 1;
      const source = {
        buffer: null,
        onended: null as null | (() => void),
        connect(node: { gain?: { value: number } }) {
          // The first node is the gain; read its value when playback starts.
          gainNode = node;
        },
        start(_when: number, offset: number) {
          volume = gainNode?.gain?.value ?? 1;
          started.push({ offset, volume, stopped: false });
          current = started.at(-1)!;
        },
        stop() {
          current.stopped = true;
        },
      };
      let gainNode: { gain?: { value: number } } | undefined;
      let current: Started = started[0];
      return source;
    },
  };
  return { context, started };
}

function player(level: "off" | "low" | "medium" | "high" = "medium") {
  const audio = fakeAudio();
  const chatter = createChatter({
    createContext: () => audio.context as unknown as AudioContext,
    hidden: () => false,
    level,
  });
  chatter.unlock();
  return { audio, chatter };
}

const listener = { x: 10, y: 10 };
/** A text record for `id`, `blocks` east of the listener. */
function textRecord(id: string, blocks: number, extra = {}) {
  return {
    id,
    x: listener.x + blocks,
    y: listener.y,
    z: 0,
    text: "Hello there",
    expiresTick: 500,
    ...extra,
  };
}

Deno.test("distance gain is full to 2 blocks and falls to 30% at 5", () => {
  assertEquals(distanceGain(0), 1);
  assertEquals(distanceGain(2), 1);
  assertAlmostEquals(distanceGain(5), 0.3);
  assert(distanceGain(3.5) < 1 && distanceGain(3.5) > 0.3);
});

Deno.test("gain at 0, 2, and 5 blocks, and for your own messages", () => {
  const { chatter } = player();
  const now = performance.now();
  chatter.update(
    [textRecord("a", 0), textRecord("b", 2), textRecord("c", 5)],
    "me",
    listener,
    now,
  );
  chatter.update([textRecord("me", 8)], "me", listener, now);
  assertEquals(chatter.log.map((entry) => entry.speaker), [
    "a",
    "b",
    "c",
    "me",
  ]);
  assertEquals(chatter.log.map((entry) => Number(entry.gain.toFixed(3))), [
    1,
    1,
    0.3,
    1,
  ]);
  assertAlmostEquals(chatter.log[2].volume, 0.3 * VOICES_VOLUME.medium);
  assertEquals(chatter.log.every((entry) => !entry.murmur), true);
  assertEquals(chatter.log[0].length, "Hello there".length);
});

Deno.test("a talking record with syllables plays a quiet filtered murmur", () => {
  const { chatter, audio } = player();
  const record = {
    id: "far",
    x: 20,
    y: 10,
    z: 0,
    talking: true,
    syllables: 4,
    expiresTick: 300,
  };
  chatter.update([record], "me", listener, performance.now());
  assertEquals(chatter.log.length, 1);
  assertEquals(chatter.log[0].murmur, true);
  assertEquals(chatter.log[0].syllables, 4);
  assertEquals(chatter.log[0].gain, 0.1);
  assertEquals(audio.started.length, 1);
  assertEquals(MURMUR_CUTOFF_HZ, 600);
  // The murmur speaks as many seeded syllables as the record carries.
  const schedule = speechSchedule(murmurText(4), voiceFromId("far"));
  assertEquals(schedule.events.filter((event) => event.spoken).length, 4);
  // A talking record without syllables stays silent.
  chatter.update(
    [{ ...record, id: "mute", syllables: undefined }],
    "me",
    listener,
    performance.now(),
  );
  assertEquals(chatter.log.length, 1);
});

Deno.test("a bubble plays once", () => {
  const { chatter } = player();
  const now = performance.now();
  const record = textRecord("a", 1);
  chatter.update([record], "me", listener, now);
  chatter.update([record], "me", listener, now + 16);
  chatter.update([{ ...record }], "me", listener, now + 32);
  assertEquals(chatter.log.length, 1);
  // A different message from the same speaker plays.
  chatter.update(
    [{ ...record, text: "Again", expiresTick: 600 }],
    "me",
    listener,
    now + 48,
  );
  assertEquals(chatter.log.length, 2);
});

Deno.test("a bubble waits for its start time, then plays at the right offset", () => {
  const { chatter, audio } = player();
  const now = performance.now();
  const bubble = {
    text: "Hello there friend",
    expiresTick: 500,
    startAt: now + 1000,
  };
  const record = textRecord("a", 1, { bubbles: [bubble] });
  chatter.update([record], "me", listener, now);
  assertEquals(chatter.log.length, 0);
  chatter.update([record], "me", listener, now + 1300);
  assertEquals(chatter.log.length, 1);
  assertAlmostEquals(audio.started[0].offset, 0.3, 1e-6);
});

Deno.test("a bubble that started longer ago than its speech is skipped", () => {
  const { chatter } = player();
  const now = performance.now();
  const length = speechSchedule("Hello there", voiceFromId("a")).duration;
  const late = textRecord("a", 1, {
    bubbles: [{
      text: "Hello there",
      expiresTick: 500,
      startAt: now - (length + 0.5) * 1000,
    }],
  });
  chatter.update([late], "me", listener, now);
  chatter.update([late], "me", listener, now + 16);
  assertEquals(chatter.log.length, 0);
});

Deno.test("six voices play at once and the nearest are kept", () => {
  const { chatter, audio } = player();
  const now = performance.now();
  const near = Array.from(
    { length: MAX_VOICES },
    (_, index) => textRecord(`n${index}`, 1 + index * 0.5),
  );
  chatter.update(near, "me", listener, now);
  assertEquals(audio.started.length, MAX_VOICES);
  // A farther speaker is dropped.
  chatter.update([textRecord("far", 4.9)], "me", listener, now + 10);
  assertEquals(audio.started.length, MAX_VOICES);
  // A nearer speaker takes the place of the farthest.
  chatter.update([textRecord("close", 0.2)], "me", listener, now + 20);
  assertEquals(audio.started.length, MAX_VOICES + 1);
  assertEquals(chatter.activeCount, MAX_VOICES);
  assertEquals(audio.started.filter((voice) => voice.stopped).length, 1);
  assertEquals(audio.started[MAX_VOICES - 1].stopped, true);
});

Deno.test("Voices Off plays nothing, and chatter stops while the tab is hidden", () => {
  const off = player("off");
  const now = performance.now();
  off.chatter.update([textRecord("a", 1)], "me", listener, now);
  assertEquals(off.chatter.log.length, 0);
  assertEquals(off.audio.started.length, 0);

  let hidden = true;
  const audio = fakeAudio();
  const chatter = createChatter({
    createContext: () => audio.context as unknown as AudioContext,
    hidden: () => hidden,
  });
  chatter.unlock();
  chatter.update([textRecord("a", 1)], "me", listener, now);
  assertEquals(chatter.log.length, 0);
  hidden = false;
  // The skipped bubble does not play when the tab returns.
  chatter.update([textRecord("a", 1)], "me", listener, now + 50);
  assertEquals(chatter.log.length, 0);
});

Deno.test("nothing plays before the first user gesture creates the audio context", () => {
  const audio = fakeAudio();
  const chatter = createChatter({
    createContext: () => audio.context as unknown as AudioContext,
    hidden: () => false,
  });
  chatter.update([textRecord("a", 1)], "me", listener, performance.now());
  assertEquals(chatter.log.length, 0);
  audio.context.state = "suspended";
  chatter.unlock();
  chatter.unlock();
  assertEquals(audio.context.resumed, 2);
});

Deno.test("a bubble with no start time starts when it first appears", () => {
  const { chatter, audio } = player();
  chatter.update([textRecord("a", 1)], "me", listener, performance.now());
  assertEquals(audio.started[0].offset, 0);
});

Deno.test("the Voices setting is saved and read back", () => {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  };
  assertEquals(parseVoicesLevel(storage.getItem(VOICES_KEY)), "medium");
  storage.setItem(VOICES_KEY, "high");
  assertEquals(parseVoicesLevel(storage.getItem(VOICES_KEY)), "high");
  assertEquals(parseVoicesLevel("loud"), "medium");
  const { chatter } = player();
  chatter.setLevel("low");
  assertEquals(chatter.level, "low");
});

Deno.test("a voice's vowel tables are built once", () => {
  const voice = voiceFromId("cache-test");
  const before = tableBuilds.count;
  const first = vowelTables(voice, 8000);
  assertEquals(Object.keys(first).sort(), ["a", "e", "i", "o", "u"]);
  assertEquals(vowelTables(voice, 8000), first);
  assertEquals(tableBuilds.count, before + 1);
});

/** A talking record for `id`, a murmur of the message that started at `startTick`. */
function murmurRecord(id: string, startTick: number, extra = {}) {
  return {
    id,
    x: listener.x + 8,
    y: listener.y,
    z: 0,
    talking: true,
    syllables: 4,
    startTick,
    expiresTick: 500,
    ...extra,
  };
}
/** A text record whose one bubble started at `startTick`. */
function startedText(id: string, startTick: number, startAt: number) {
  return textRecord(id, 1, {
    bubbles: [{ text: "Hello there", expiresTick: 500, startTick, startAt }],
  });
}

Deno.test("unlock sets audioSession.type to playback when present", () => {
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const session = { type: "auto" };
  Object.defineProperty(globalThis, "navigator", {
    value: { audioSession: session },
    configurable: true,
  });
  try {
    const { chatter } = player();
    chatter.unlock();
    assertEquals(session.type, "playback");
  } finally {
    if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
  }
});

Deno.test("unlock plays a silent element once when there is no audioSession", () => {
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const played: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
  });
  Object.defineProperty(globalThis, "Audio", {
    value: class {
      constructor(public src: string) {}
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
    },
    configurable: true,
    writable: true,
  });
  try {
    const { chatter } = player();
    chatter.unlock();
    chatter.unlock();
    assertEquals(played.length, 1);
    assert(played[0].startsWith("data:audio/wav;base64,"));
  } finally {
    if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
    if (audioDescriptor) {
      Object.defineProperty(globalThis, "Audio", audioDescriptor);
    } else delete (globalThis as { Audio?: unknown }).Audio;
  }
});

Deno.test("unlock never throws", () => {
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  Object.defineProperty(globalThis, "navigator", {
    value: {
      get audioSession() {
        throw new Error("no session");
      },
    },
    configurable: true,
  });
  try {
    player().chatter.unlock();
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(globalThis, "Audio", {
      value: class {
        constructor() {
          throw new Error("no audio");
        }
      },
      configurable: true,
      writable: true,
    });
    player().chatter.unlock();
  } finally {
    if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
    if (audioDescriptor) {
      Object.defineProperty(globalThis, "Audio", audioDescriptor);
    } else delete (globalThis as { Audio?: unknown }).Audio;
  }
});

Deno.test("text then murmur of one message plays once", () => {
  const { chatter } = player();
  const now = performance.now();
  chatter.update([startedText("a", 100, now)], "me", listener, now);
  chatter.update(
    [murmurRecord("a", 100, { startAt: now + 5 })],
    "me",
    listener,
    now + 16,
  );
  assertEquals(chatter.log.length, 1);
  assertEquals(chatter.log[0].murmur, false);
});

Deno.test("murmur then text of one message plays once", () => {
  const { chatter } = player();
  const now = performance.now();
  chatter.update(
    [murmurRecord("a", 100, { startAt: now })],
    "me",
    listener,
    now,
  );
  chatter.update([startedText("a", 100, now + 5)], "me", listener, now + 16);
  assertEquals(chatter.log.length, 1);
  assertEquals(chatter.log[0].murmur, true);
});

Deno.test("two different messages each play", () => {
  const { chatter } = player();
  const now = performance.now();
  chatter.update([startedText("a", 100, now)], "me", listener, now);
  chatter.update(
    [murmurRecord("a", 140, { startAt: now + 100 })],
    "me",
    listener,
    now + 200,
  );
  chatter.update([startedText("a", 180, now + 300)], "me", listener, now + 400);
  assertEquals(chatter.log.map((entry) => entry.murmur), [false, true, false]);
});

Deno.test("a late murmur starts at its offset, and is skipped once the speech is over", () => {
  const { chatter, audio } = player();
  const now = performance.now();
  chatter.update(
    [murmurRecord("a", 100, { startAt: now - 300 })],
    "me",
    listener,
    now,
  );
  assertEquals(chatter.log.length, 1);
  assertAlmostEquals(audio.started[0].offset, 0.3, 1e-6);
  const length = speechSchedule(murmurText(4), voiceFromId("b")).duration;
  chatter.update(
    [murmurRecord("b", 100, { startAt: now - (length + 0.5) * 1000 })],
    "me",
    listener,
    now,
  );
  assertEquals(chatter.log.length, 1);
});
