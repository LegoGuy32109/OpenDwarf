import { assert, assertEquals } from "@std/assert";
import { createSoundEvents } from "../../src/client/sound-events.js";
import { LATE_MS } from "../../src/client/sfx.js";
import { addPlayer, createWorld } from "../../src/shared/world.js";
import { enableLocomotion } from "../../src/shared/locomotion.js";
import {
  ensureChunk,
  OPEN,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";

type Call = { tags: string[]; options?: Record<string, unknown> };

function setup() {
  const world = createWorld();
  const data = ensureChunk(world, 0, 0);
  data.fill(OPEN);
  data.fill(STONE, 0, 256);
  writeTile(world, 6, 5, 1, STONE);
  writeTile(world, 6, 6, 1, STONE);
  const player = enableLocomotion(addPlayer(world, "me", { x: 3, y: 5, z: 1 }));
  const played: Call[] = [];
  const listeners: unknown[] = [];
  let heardAt: number | null = performance.now();
  const scene = {
    world,
    localId: "me",
    presentation: { timeOfTick: (_tick: number) => heardAt },
    mining: [] as {
      id: string;
      x: number;
      y: number;
      z: number;
      progress: number;
    }[],
  };
  const sfx = {
    play: (tags: string[], options?: Record<string, unknown>) =>
      played.push({ tags, options }),
    setListener: (listener: unknown) => listeners.push(listener),
  };
  const sounds = createSoundEvents({
    scene,
    sfx: sfx as unknown as Parameters<typeof createSoundEvents>[0]["sfx"],
  });
  return {
    world,
    player,
    scene,
    sounds,
    played,
    listeners,
    setHeardAt: (time: number | null) => heardAt = time,
  };
}

Deno.test("a heard event plays at its presentation time, muffled when unseen", () => {
  const { sounds, played, setHeardAt } = setup();
  const at = performance.now() + 100;
  setHeardAt(at);
  sounds.hear([
    { tags: ["step", "walk", "stone"], x: 9, y: 5, z: 1, tick: 4, seen: true },
    { tags: ["mine", "hit", "coal"], x: 10, y: 5, z: 1, tick: 4, seen: false },
  ]);
  assertEquals(played.map((call) => call.options?.muffled), [false, true]);
  assertEquals(played[0].options, { x: 9, y: 5, z: 1, muffled: false, at });
  assertEquals(
    sounds.log.map((entry) => [entry.tags[0], entry.muffled, entry.own]),
    [["step", false, false], ["mine", true, false]],
  );
});

Deno.test("an event later than LATE_MS is dropped, and one with no clock plays now", () => {
  const { sounds, played, setHeardAt } = setup();
  const event = {
    tags: ["pickup"],
    x: 4,
    y: 5,
    z: 1,
    tick: 1,
    seen: true,
  };
  setHeardAt(performance.now() - LATE_MS - 50);
  sounds.hear([event]);
  assertEquals(played, []);
  assertEquals(sounds.log, []);
  setHeardAt(null);
  sounds.hear([event]);
  assertEquals(played.length, 1);
});

Deno.test("own steps play at once, from predicted motion only", () => {
  const { sounds, played, player } = setup();
  sounds.ownSteps(false);
  player.x = 4.5;
  sounds.ownSteps(false); // a snap while standing: no step
  assertEquals(played, []);
  player.vx = 1;
  player.x = 5.6;
  sounds.ownSteps(true);
  assertEquals(played.map((call) => call.tags), [
    ["step", "run", "stone"],
    ["step", "run", "stone"],
  ]);
  assertEquals(played[0].options, undefined);
  assert(sounds.log.every((entry) => entry.own && !entry.muffled));
});

Deno.test("own mining hits at the start and every 500 ms, then breaks", () => {
  const { sounds, played, scene, listeners } = setup();
  const entry = { id: "me", x: 6, y: 5, z: 1, progress: 0 };
  scene.mining = [entry];
  sounds.frame(1000, 0);
  sounds.frame(1200, 0);
  sounds.frame(1500, 0);
  entry.progress = 0.95;
  sounds.frame(1700, 0);
  scene.mining = [];
  sounds.frame(1800, 0);
  assertEquals(played.map((call) => call.tags), [
    ["mine", "hit", "stone"],
    ["mine", "hit", "stone"],
    ["mine", "break", "stone"],
  ]);
  assertEquals(listeners.length, 5);
});

Deno.test("cancelled mining makes no break, and another's mining is not ours", () => {
  const { sounds, played, scene } = setup();
  scene.mining = [
    { id: "other", x: 6, y: 5, z: 1, progress: 0.9 },
    { id: "me", x: 6, y: 6, z: 1, progress: 0.1 },
  ];
  sounds.frame(1000, 0);
  scene.mining = [];
  sounds.frame(1100, 0);
  assertEquals(played.map((call) => call.tags[1]), ["hit"]);
});
