import { assert, assertEquals } from "@std/assert";
import {
  revealedLength,
  speechDurationMs,
  speechSchedule,
  syllableCount,
  syllables,
  VOICE_RANGES,
  voiceFromId,
} from "../../src/shared/speech.js";
import { synthesize } from "../../prototype/voice.js";

const text = "Welcome, traveler! Is something moving beneath the mountain?";

Deno.test("syllables keep the exact text and end at their offsets", () => {
  const units = syllables(text);
  assertEquals(units.map((unit) => unit.text).join(""), text);
  for (const unit of units) {
    assertEquals(text.slice(0, unit.index).endsWith(unit.text), true);
  }
  assertEquals(syllables("traveler").map((unit) => unit.text), [
    "trav",
    "el",
    "er",
  ]);
  assertEquals(syllableCount("hello there"), 3);
  assertEquals(syllableCount("..."), 0);
});

Deno.test("a seeded voice is stable and inside the ranges", () => {
  assertEquals(voiceFromId("peer-abc"), voiceFromId("peer-abc"));
  for (const id of ["host", "peer-1", "peer-2", "npc-corner", "x".repeat(40)]) {
    const voice = voiceFromId(id);
    for (const key of ["pitch", "formant", "speed"] as const) {
      const [min, max] = VOICE_RANGES[key];
      assert(voice[key] >= min && voice[key] <= max, `${key} ${voice[key]}`);
    }
    assert(Number.isInteger(voice.seed));
  }
  assert(
    JSON.stringify(voiceFromId("peer-1")) !==
      JSON.stringify(voiceFromId("peer-2")),
  );
});

Deno.test("the schedule matches the prototype's audio timing", () => {
  const voice = { pitch: 155, formant: 1.02, speed: 1.02, seed: 59 };
  const context = {
    sampleRate: 8000,
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
  };
  const prototype = synthesize(context as unknown as AudioContext, text, {
    name: "Mara",
    role: "",
    ...voice,
  });
  const schedule = speechSchedule(text, voice);
  assertEquals(schedule.duration, prototype.duration);
  assertEquals(
    schedule.events.map((event) => [event.start, event.duration, event.pitch]),
    prototype.events.map((event) => [event.start, event.duration, event.pitch]),
  );
});

Deno.test("the reveal grows by syllable and ends with the whole text", () => {
  const voice = voiceFromId("peer-reveal");
  const schedule = speechSchedule(text, voice);
  const total = speechDurationMs(text, voice);
  assertEquals(revealedLength(schedule, text, -1), 0);
  let last = 0;
  for (let ms = 0; ms <= total; ms += 25) {
    const length = revealedLength(schedule, text, ms);
    assert(length >= last);
    last = length;
  }
  assertEquals(revealedLength(schedule, text, total), text.length);
  assert(total > 2000 && total < 8000, `duration ${total}`);
});
