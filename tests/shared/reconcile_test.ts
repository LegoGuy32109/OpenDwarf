import { assertEquals } from "@std/assert";
import { mergeSnapshot } from "../../src/shared/reconcile.js";
import {
  addPlayer,
  advanceTicks,
  createWorld,
  renderPosition,
  startMove,
} from "../../src/shared/world.js";

Deno.test("unacknowledged local movement survives an older host snapshot", () => {
  const local = createWorld();
  const snapshot = createWorld();
  addPlayer(local, "admin", { x: 8, y: 7, z: 0 });
  addPlayer(snapshot, "admin", { x: 8, y: 7, z: 0 });
  assertEquals(startMove(local, "admin", 1, 0, 4).ok, true);
  advanceTicks(local, 5);
  mergeSnapshot(local, snapshot, 3, 4, "admin");
  assertEquals(local.players.admin.move?.sequence, 4);
  assertEquals(renderPosition(local.players.admin, local.tick).x, 8.5);
});

Deno.test("confirmed move keeps the client's animation clock", () => {
  const local = createWorld();
  const snapshot = createWorld();
  addPlayer(local, "admin", { x: 8, y: 7, z: 0 });
  addPlayer(snapshot, "admin", { x: 8, y: 7, z: 0 });
  assertEquals(startMove(local, "admin", 1, 0, 4).ok, true);
  advanceTicks(local, 5);
  assertEquals(startMove(snapshot, "admin", 1, 0, 4).ok, true);
  advanceTicks(snapshot, 2);
  const result = mergeSnapshot(local, snapshot, 4, 4, "admin");
  assertEquals(result.corrected, false);
  assertEquals(renderPosition(local.players.admin, local.tick).x, 8.5);
});

Deno.test("a completed local step stays put until the host acknowledges it", () => {
  const local = createWorld();
  const snapshot = createWorld();
  addPlayer(local, "admin", { x: 8, y: 7, z: 0 });
  addPlayer(snapshot, "admin", { x: 8, y: 7, z: 0 });
  assertEquals(startMove(local, "admin", 1, 0, 4).ok, true);
  advanceTicks(local, 10);
  assertEquals(local.players.admin.move, null);
  mergeSnapshot(local, snapshot, 3, 4, "admin");
  assertEquals(local.players.admin.x, 9);
});

Deno.test("remote move adopts local tick once and ignores repeat snapshots", () => {
  const local = createWorld();
  const snapshot = createWorld();
  addPlayer(local, "admin", { x: 10, y: 7, z: 0 });
  addPlayer(snapshot, "admin", { x: 10, y: 7, z: 0 });
  addPlayer(snapshot, "self", { x: 7, y: 7, z: 0 });
  advanceTicks(local, 100);
  advanceTicks(snapshot, 20);
  assertEquals(startMove(snapshot, "self", 1, 0, 1).ok, true);
  advanceTicks(snapshot, 2);
  mergeSnapshot(local, snapshot, 0, 0, "admin");
  assertEquals(renderPosition(local.players.self, local.tick).x, 7.2);
  advanceTicks(local, 3);
  advanceTicks(snapshot, 1);
  mergeSnapshot(local, snapshot, 0, 0, "admin");
  assertEquals(renderPosition(local.players.self, local.tick).x, 7.5);
});

Deno.test("rejected movement produces an authoritative correction", () => {
  const local = createWorld();
  const snapshot = createWorld();
  addPlayer(local, "admin", { x: 8, y: 7, z: 0 });
  addPlayer(snapshot, "admin", { x: 8, y: 7, z: 0 });
  assertEquals(startMove(local, "admin", 1, 0, 4).ok, true);
  advanceTicks(local, 5);
  assertEquals(mergeSnapshot(local, snapshot, 4, 4, "admin").corrected, true);
  assertEquals(local.players.admin.move, null);
  assertEquals(local.players.admin.x, 8);
});
