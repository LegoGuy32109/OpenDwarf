// Sound event tests (ADR 0008).
import { assert, assertEquals } from "@std/assert";
import {
  addPlayer,
  advanceTicks,
  createWorld,
  type World,
} from "../../src/shared/world.js";
import {
  drainTileChanges,
  ensureChunk,
  OPEN,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";
import { COAL } from "../../src/shared/materials.js";
import {
  addStack,
  dropItem,
  inventoryOf,
  pickUp,
} from "../../src/shared/items.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import { enableLocomotion, moveEntity } from "../../src/shared/locomotion.js";
import {
  completeMining,
  startMining,
  stepMining,
} from "../../src/shared/mining.js";
import { placeStone } from "../../src/shared/placing.js";
import {
  createStepTracker,
  drainSounds,
  MAX_SOUND_ENTRIES,
  MINE_HIT_MS,
  recordSound,
  recordSteps,
  SOUND_RANGE,
  SOUND_Z_LIMIT,
  soundsFor,
  sourceTile,
  STEP_DISTANCE,
  stepsTaken,
} from "../../src/shared/sound.js";

/** Open air at level 1 and above, a stone floor at level 0. */
function field(): World {
  const world = createWorld();
  const data = ensureChunk(world, 0, 0);
  data.fill(OPEN);
  data.fill(STONE, 0, 256);
  return world;
}

/** A walker at (3, 5, 1) on the stone floor. */
function walker() {
  const world = field();
  const player = enableLocomotion(
    addPlayer(world, "self", { x: 3, y: 5, z: 1 }),
  );
  return { world, player };
}

/** Walk east for `ticks` ticks at `speed` tiles per second and collect the sound events. */
function walk(ticks: number, speed: number, running: boolean) {
  const { world, player } = walker();
  for (let i = 0; i < ticks; i++) {
    advanceTicks(world);
    moveEntity(world, "self", 1, 0, speed);
    recordSteps(world, () => running);
  }
  return { world, player, events: drainSounds(world) };
}

Deno.test("a step is recorded every STEP_DISTANCE tiles traveled", () => {
  const tracker = createStepTracker();
  assertEquals(stepsTaken(tracker, 0, 0), 0);
  assertEquals(stepsTaken(tracker, 0.2, 0), 0);
  assertEquals(stepsTaken(tracker, 0.4, 0), 0);
  assertEquals(stepsTaken(tracker, 0.6, 0), 1);
  assertEquals(stepsTaken(tracker, 1.7, 0), 2);
  // The remainder carries over: 0.2 left, then 0.4 more makes 0.6.
  assertEquals(stepsTaken(tracker, 2.1, 0), 1);
  assertEquals(stepsTaken(tracker, 2.2, 0), 0);
  // Standing still adds nothing; a teleport only sets the new start.
  assertEquals(stepsTaken(tracker, 2.2, 0), 0);
  assertEquals(stepsTaken(tracker, 40, 40), 0);
  assertEquals(stepsTaken(tracker, 40.5, 40), 1);
});

Deno.test("walking steps are tagged walk and the floor material, and spaced by distance", () => {
  const { player, events } = walk(100, 1, false);
  const traveled = player.x - 3;
  assertEquals(events.length, Math.floor(traveled / STEP_DISTANCE));
  assert(events.length >= 8, `${events.length} steps`);
  for (const event of events) {
    assertEquals(event.tags, ["step", "walk", "stone"]);
    assertEquals(event.source, "self");
    assertEquals(event.z, 1);
  }
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].x - events[i - 1].x;
    assert(Math.abs(gap - STEP_DISTANCE) < 0.06, `gap ${gap}`);
  }
});

Deno.test("running steps are tagged run and come twice as often", () => {
  const walking = walk(100, 1, false).events.length;
  const { events } = walk(100, 2, true);
  assert(events.every((event) => event.tags[1] === "run"));
  assert(events.length >= walking * 1.6, `${events.length} vs ${walking}`);
});

Deno.test("the floor material names the tag, and air under an entity adds none", () => {
  const { world, player } = walker();
  writeTile(world, 4, 5, 0, COAL);
  writeTile(world, 5, 5, 0, OPEN);
  drainTileChanges(world);
  player.vx = 1;
  player.x = 3.5;
  recordSteps(world, () => false);
  player.x = 4;
  recordSteps(world, () => false);
  player.x = 4.5;
  recordSteps(world, () => false);
  const [first, second] = drainSounds(world);
  assertEquals(first.tags, ["step", "walk", "coal"]);
  assertEquals(second.tags, ["step", "walk"]);
});

Deno.test("a correction that moves a standing entity is not a step", () => {
  const { world, player } = walker();
  recordSteps(world, () => false);
  player.x = 4.5;
  recordSteps(world, () => false);
  player.x = 5;
  recordSteps(world, () => false);
  assertEquals(drainSounds(world), []);
  player.vx = 1;
  player.x = 5.5;
  recordSteps(world, () => false);
  assertEquals(drainSounds(world).length, 1);
});

Deno.test("an entity that is not a person steps like one, with its own source", () => {
  const world = field();
  addPlayer(world, "npc-corner", { x: 3, y: 5, z: 1 });
  Object.assign(world.players["npc-corner"], { vx: 1 });
  recordSteps(world, () => false);
  world.players["npc-corner"].x = 4;
  recordSteps(world, () => false);
  const events = drainSounds(world);
  assertEquals(events.map((event) => event.source), [
    "npc-corner",
    "npc-corner",
  ]);
});

/** A miner at (5, 5, 1) with stone at (6, 5, 1). */
function miner() {
  const world = field();
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  writeTile(world, 6, 5, 1, STONE);
  writeTile(world, 6, 6, 1, COAL);
  drainTileChanges(world);
  return { world, player };
}

Deno.test("mining hits when the action starts and every MINE_HIT_MS, then breaks", () => {
  const { world } = miner();
  assert(startMining(world, "self", { x: 6, y: 5, z: 1 }).ok);
  const hits: number[] = [];
  const events: ReturnType<typeof drainSounds> = [];
  for (let i = 0; i < 40; i++) {
    stepMining(world);
    for (const event of drainSounds(world)) {
      events.push(event);
      if (event.tags[1] === "hit") hits.push(world.tick);
    }
    advanceTicks(world);
  }
  // Stone takes 1000 ms: hits at 0 and 500 ms, then the break.
  assertEquals(hits, [0, MINE_HIT_MS / 50]);
  assertEquals(events.map((event) => event.tags), [
    ["mine", "hit", "stone"],
    ["mine", "hit", "stone"],
    ["mine", "break", "stone"],
  ]);
  const last = events.at(-1)!;
  assertEquals([last.x, last.y, last.z, last.source], [6, 5, 1, "self"]);
});

Deno.test("a longer ore hits more often and names its material", () => {
  const { world } = miner();
  assert(startMining(world, "self", { x: 6, y: 6, z: 1 }).ok);
  const events = [];
  for (let i = 0; i < 60; i++) {
    stepMining(world);
    events.push(...drainSounds(world));
    advanceTicks(world);
  }
  // Coal takes 1500 ms: hits at 0, 500 and 1000 ms, then the break.
  assertEquals(events.map((event) => event.tags.slice(0, 2).join(" ")), [
    "mine hit",
    "mine hit",
    "mine hit",
    "mine break",
  ]);
  assert(events.every((event) => event.tags[2] === "coal"));
});

Deno.test("a cancelled mining action makes no break", () => {
  const { world, player } = miner();
  startMining(world, "self", { x: 6, y: 5, z: 1 });
  stepMining(world);
  player.x = 9;
  advanceTicks(world);
  stepMining(world);
  assertEquals(
    drainSounds(world).map((event) => event.tags[1]),
    ["hit"],
  );
});

Deno.test("completeMining records the break on the tile", () => {
  const { world } = miner();
  completeMining(world, {
    playerId: "self",
    x: 6,
    y: 5,
    z: 1,
    material: STONE,
    held: "pickaxe",
    startTick: 0,
    durationTicks: 20,
  });
  const [event] = drainSounds(world);
  assertEquals(event.tags, ["mine", "break", "stone"]);
});

Deno.test("placing stone records a place event only on success", () => {
  const { world, player } = miner();
  addStack(inventoryOf(player), "stone", 2);
  setHeldItem(world, "self", "stone");
  assert(placeStone(world, "self", { x: 4, y: 5, z: 1 }).ok);
  assert(!placeStone(world, "self", { x: 4, y: 5, z: 1 }).ok);
  const events = drainSounds(world);
  assertEquals(events.length, 1);
  assertEquals(events[0].tags, ["place", "stone"]);
  assertEquals([events[0].x, events[0].y, events[0].z], [4, 5, 1]);
});

Deno.test("a pickup records an event only on success", () => {
  const { world } = miner();
  dropItem(world, { x: 5, y: 6, z: 1 }, "coal", 1);
  assert(!pickUp(world, "self", { x: 4, y: 5, z: 1 }, "coal").ok);
  assertEquals(drainSounds(world), []);
  assert(pickUp(world, "self", { x: 5, y: 6, z: 1 }, "coal").ok);
  const [event] = drainSounds(world);
  assertEquals(event.tags, ["pickup"]);
  assertEquals(event.source, "self");
  assertEquals(drainSounds(world), []);
});

Deno.test("recorded events carry the tick and drain once", () => {
  const world = field();
  advanceTicks(world, 7);
  recordSound(world, { tags: ["pickup"], x: 1, y: 2, z: 1, source: "a" });
  assertEquals(drainSounds(world).map((event) => event.tick), [7]);
  assertEquals(drainSounds(world), []);
});

function listening() {
  const world = field();
  addPlayer(world, "me", { x: 20, y: 5, z: 1 });
  addPlayer(world, "other", { x: 21, y: 5, z: 1 });
  const at = (x: number, y = 5, z = 1, source = "other") => ({
    tags: ["step", "walk", "stone"],
    x,
    y,
    z,
    tick: 3,
    source,
  });
  return { world, at };
}

Deno.test("a listener hears events inside the range and levels, never beyond", () => {
  const { world, at } = listening();
  const events = [
    at(20 + SOUND_RANGE),
    at(20 + SOUND_RANGE + 0.1),
    at(20, 5 - SOUND_RANGE),
    at(20, 5 + SOUND_RANGE + 1),
    at(20 - 8, 5 + 8),
    at(20 + 9, 5 + 9),
    at(20, 5, 1 + SOUND_Z_LIMIT),
    at(20, 5, 1 + SOUND_Z_LIMIT + 1),
  ];
  const heard = soundsFor(world, events, "me", () => true);
  assertEquals(
    heard.map((sound) => [sound.x, sound.y, sound.z]),
    [
      [32, 5, 1],
      [20, -7, 1],
      [12, 13, 1],
      [20, 5, 5],
    ],
  );
});

Deno.test("a listener does not hear its own events", () => {
  const { world, at } = listening();
  const heard = soundsFor(
    world,
    [at(21, 5, 1, "me"), at(21, 5, 1, "other")],
    "me",
    () => true,
  );
  assertEquals(heard.length, 1);
  assertEquals(soundsFor(world, [at(21)], "nobody", () => true), []);
});

Deno.test("seen comes from the sight callback, on the source entity or on the tile", () => {
  const { world, at } = listening();
  const stepEvent = at(25);
  const breakEvent = {
    ...at(23, 5),
    tags: ["mine", "break", "stone"],
    source: "other",
  };
  assertEquals(sourceTile(world, stepEvent), { x: 21, y: 5, z: 1 });
  assertEquals(sourceTile(world, breakEvent), { x: 23, y: 5, z: 1 });
  const placeEvent = { ...at(22, 6), tags: ["place", "stone"] };
  assertEquals(sourceTile(world, placeEvent), { x: 22, y: 6, z: 1 });
  const hitEvent = { ...at(23, 5), tags: ["mine", "hit", "stone"] };
  assertEquals(sourceTile(world, hitEvent), { x: 21, y: 5, z: 1 });
  const seen = new Set(["21,5,1"]);
  const heard = soundsFor(
    world,
    [stepEvent, breakEvent],
    "me",
    (event) => {
      const tile = sourceTile(world, event);
      return seen.has(`${tile.x},${tile.y},${tile.z}`);
    },
  );
  assertEquals(heard.map((sound) => sound.seen), [true, false]);
});

Deno.test("a listener is sent at most MAX_SOUND_ENTRIES, the newest", () => {
  const { world, at } = listening();
  const events = Array.from(
    { length: MAX_SOUND_ENTRIES + 5 },
    (_, i) => ({ ...at(21), tick: i }),
  );
  const heard = soundsFor(world, events, "me", () => true);
  assertEquals(heard.length, MAX_SOUND_ENTRIES);
  assertEquals(heard.at(-1)!.tick, MAX_SOUND_ENTRIES + 4);
  assertEquals(heard[0].tick, 5);
});
