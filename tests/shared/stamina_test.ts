import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  createStamina,
  REFILL_SECONDS,
  setSprint,
  SPRINT_SECONDS,
  stepStamina,
} from "../../src/shared/stamina.js";
import {
  addPlayer,
  advanceTicks,
  createWorld,
  TICK_MS,
} from "../../src/shared/world.js";
import { OPEN, STONE, writeTile } from "../../src/shared/terrain.js";
import {
  enableLocomotion,
  moveEntity,
  speedTilesPerSecond,
} from "../../src/shared/locomotion.js";

const TICKS_PER_SECOND = 1000 / TICK_MS;

function run(stamina: ReturnType<typeof createStamina>, seconds: number) {
  for (let i = 0; i < Math.round(seconds * TICKS_PER_SECOND); i++) {
    stepStamina(stamina);
  }
}

Deno.test("sprint drains a full reserve over six seconds", () => {
  const stamina = createStamina();
  setSprint(stamina, true);
  run(stamina, SPRINT_SECONDS / 2);
  assertAlmostEquals(stamina.value, 0.5, 0.02);
  assert(stamina.sprint);
});

Deno.test("stamina refills in proportion over twelve seconds", () => {
  const stamina = createStamina();
  stamina.value = 0.5;
  run(stamina, REFILL_SECONDS / 4);
  assertAlmostEquals(stamina.value, 0.75, 0.02);
  run(stamina, REFILL_SECONDS);
  assertEquals(stamina.value, 1);
});

Deno.test("turning sprint off by hand allows sprint again above zero", () => {
  const stamina = createStamina();
  setSprint(stamina, true);
  run(stamina, 2);
  setSprint(stamina, false);
  assertEquals(stamina.sprint, false);
  assertEquals(stamina.locked, false);
  setSprint(stamina, true);
  assert(stamina.sprint);
});

Deno.test("exhaustion turns sprint off and locks it until stamina is full", () => {
  const stamina = createStamina();
  setSprint(stamina, true);
  run(stamina, SPRINT_SECONDS + 0.5);
  assert(stamina.value < 0.1, "reserve is empty and starts to refill");
  assertEquals(stamina.sprint, false);
  assert(stamina.locked);
  setSprint(stamina, true);
  assertEquals(stamina.sprint, false);
  run(stamina, REFILL_SECONDS / 2);
  setSprint(stamina, true);
  assertEquals(stamina.sprint, false, "still locked at half stamina");
  run(stamina, REFILL_SECONDS / 2 + 0.2);
  assertEquals(stamina.value, 1);
  assertEquals(stamina.locked, false);
  setSprint(stamina, true);
  assert(stamina.sprint);
});

Deno.test("a guest that claims sprint without stamina moves at walk speed", () => {
  const distance = (stamina: ReturnType<typeof createStamina>) => {
    const world = createWorld();
    for (const chunk of world.chunks.values()) chunk.fill(OPEN);
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) writeTile(world, x, y, 0, STONE);
    }
    const player = enableLocomotion(
      addPlayer(world, "self", { x: 2, y: 7, z: 1 }),
    );
    for (let i = 0; i < 40; i++) {
      advanceTicks(world);
      // The host applies each claimed sprint through the stamina rules.
      setSprint(stamina, true);
      moveEntity(world, "self", 1, 0, speedTilesPerSecond(stamina.sprint));
      stepStamina(stamina);
    }
    return player.x - 2;
  };
  const empty = createStamina();
  empty.value = 0;
  empty.locked = true;
  const walk = distance(empty);
  const full = distance(createStamina());
  assert(walk > 1.5 && walk < 2.1, `walked ${walk}`);
  assert(full > walk * 1.7, `sprinted ${full}`);
});
