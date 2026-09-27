import { assert, assertEquals } from "@std/assert";
import { createCornerNpc } from "../../src/shared/npc.js";
import { acceptMoveIntent } from "../../src/shared/protocol.js";
import {
  addPlayer,
  advanceTicks,
  createWorld,
  startMove,
} from "../../src/shared/world.js";

for (const rtt of [20, 50, 100, 200]) {
  Deno.test(`ordered movement survives ${rtt} ms RTT, jitter and a lost first send`, () => {
    const world = createWorld();
    addPlayer(world, "admin", { x: 2, y: 7, z: 0 });
    const oneWayTicks = Math.max(1, Math.ceil(rtt / 100));
    const events: { tick: number; sequence: number }[] = [];
    for (let sequence = 1; sequence <= 5; sequence++) {
      const sent = (sequence - 1) * 20;
      const jitter = sequence % 2 === 0 ? 2 : 0;
      events.push({
        tick: sent + oneWayTicks + jitter + (sequence === 3 ? 4 : 0),
        sequence,
      });
      if (sequence !== 3) {
        events.push({ tick: sent + oneWayTicks + jitter + 4, sequence });
      }
    }
    let lastSequence = 0;
    let accepted = 0;
    for (let tick = 0; tick < 130; tick++) {
      for (const event of events.filter((item) => item.tick === tick)) {
        const result = acceptMoveIntent(
          world,
          "admin",
          { dx: 1, dy: 0, sequence: event.sequence },
          lastSequence,
        );
        lastSequence = result.sequence;
        if (result.ok) accepted++;
      }
      advanceTicks(world);
    }
    assertEquals(lastSequence, 5);
    assertEquals(accepted, 5);
    assertEquals(world.players.admin.x, 7);
  });
}

Deno.test("corner NPC uses player collision and pauses after two loops", () => {
  const world = createWorld();
  const tickNpc = createCornerNpc(world);
  const npc = world.players["npc-corner"];
  assert(tickNpc());
  assertEquals(npc.move?.target, { x: 3, y: 2, z: 0 });
  advanceTicks(world, 10);
  addPlayer(world, "self", { x: 3, y: 3, z: 0 });
  assertEquals(tickNpc(), false);
  assertEquals(startMove(world, "self", 0, -1, 1).reason, "occupied");
  world.players.self.x = 8;
  world.players.self.y = 7;
  let starts = 1;
  for (let tick = 0; tick < 220; tick++) {
    if (tickNpc()) starts++;
    advanceTicks(world);
  }
  assert(starts >= 8);
  assert(starts <= 20);
});
