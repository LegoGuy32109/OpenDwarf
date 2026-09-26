import { assertEquals } from "@std/assert";
import { acceptMoveIntent } from "../../src/shared/protocol.js";
import {
  addPlayer,
  advanceTicks,
  createWorld,
  occupiedTiles,
  renderPosition,
  setNickname,
  setTyping,
  startMove,
  submitMessage,
} from "../../src/shared/world.js";

type Packet = { at: number; sequence: number; dx: number; dy: number };

function deliver(world: ReturnType<typeof createWorld>, packets: Packet[]) {
  let lastSequence = 0;
  for (const packet of [...packets].sort((a, b) => a.at - b.at)) {
    const result = acceptMoveIntent(world, "admin", packet, lastSequence);
    lastSequence = result.sequence;
  }
  return lastSequence;
}

Deno.test("delayed, reordered and duplicated move intents apply at most once", () => {
  const world = createWorld();
  addPlayer(world, "admin", { x: 8, y: 8 });
  const last = deliver(world, [
    { at: 250, sequence: 1, dx: -1, dy: 0 },
    { at: 100, sequence: 2, dx: 1, dy: 0 },
    { at: 300, sequence: 2, dx: 1, dy: 0 },
  ]);
  assertEquals(last, 2);
  assertEquals(world.players.admin.move?.target, { x: 9, y: 8 });
  assertEquals(occupiedTiles(world.players.admin, 3), [
    { x: 8, y: 8 },
    { x: 9, y: 8 },
  ]);
  assertEquals(renderPosition(world.players.admin, 5), { x: 8.5, y: 8 });
  advanceTicks(world, 10);
  assertEquals(world.players.admin.x, 9);
  assertEquals(world.players.admin.move, null);
});

Deno.test("lost first request can retry without moving twice", () => {
  const world = createWorld();
  addPlayer(world, "admin", { x: 8, y: 8 });
  const retry = { at: 200, sequence: 1, dx: 0, dy: -1 };
  const last = deliver(world, [retry]);
  advanceTicks(world, 10);
  assertEquals(world.players.admin.y, 7);
  const duplicate = acceptMoveIntent(world, "admin", retry, last);
  assertEquals(duplicate.reason, "stale input");
  assertEquals(world.players.admin.y, 7);
});

Deno.test("host correction cancels a predicted move", () => {
  const client = createWorld();
  const host = createWorld();
  addPlayer(client, "admin", { x: 14, y: 8 });
  addPlayer(host, "admin", { x: 15, y: 8 });
  assertEquals(startMove(client, "admin", 1, 0, 1).ok, true);
  assertEquals(
    acceptMoveIntent(host, "admin", { dx: 1, dy: 0, sequence: 1 }, 0).ok,
    false,
  );
  const reconciled = structuredClone(host);
  assertEquals(reconciled.players.admin.move, null);
  assertEquals(reconciled.players.admin.x, 15);
});

Deno.test("name claims and typing state belong to one world", () => {
  const world = createWorld();
  addPlayer(world, "self");
  addPlayer(world, "admin");
  assertEquals(setNickname(world, "self", "Josh Hale").ok, true);
  assertEquals(
    setNickname(world, "admin", "josh hale").reason,
    "name is taken",
  );
  setTyping(world, "self", true);
  assertEquals(world.players.self.typing, true);
  submitMessage(world, "self", "hey everyone");
  assertEquals(world.players.self.typing, false);
  assertEquals(world.players.self.message, "hey everyone");
});
