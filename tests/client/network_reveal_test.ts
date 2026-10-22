import { assert, assertEquals } from "@std/assert";
import { revealPeerChanges } from "../../src/client/network-reveal.js";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { createPendingReveal, drainReveal } from "../../src/shared/reveal.js";
import {
  drainTileChanges,
  OPEN,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";
import { entityView } from "../../src/shared/view.js";
import { createVisibility, tileKey } from "../../src/shared/visibility.js";
import { addPlayer } from "../../src/shared/world.js";

Deno.test("a snapshot before the tile drain cannot keep a stationary guest's old sight", () => {
  const world = createAuthoredWorld();
  for (let z = 0; z <= 7; z++) {
    for (let y = 0; y < 16; y++) writeTile(world, 8, y, z, STONE);
  }
  writeTile(world, 7, 8, 0, OPEN);
  writeTile(world, 9, 8, 0, OPEN);
  drainTileChanges(world);
  addPlayer(world, "guest", { x: 7, y: 8, z: 0 });
  const guest = {
    mode: "entity" as const,
    sight: createVisibility(),
    remembered: new Map<string, Uint8Array>(),
    master: new Map<string, Uint8Array>(),
    pending: createPendingReveal(),
  };
  const publish = () => {
    entityView(world, "guest", guest.sight, guest.remembered, guest.pending);
    return drainReveal(guest.remembered, guest.pending);
  };
  publish();
  const beyondWall = tileKey(9, 8, 0);
  assert(!guest.sight.visible.has(beyondWall));
  writeTile(world, 8, 8, 0, OPEN);
  // An action callback can publish before publishSounds drains tile changes.
  publish();
  assert(!guest.sight.visible.has(beyondWall));
  assertEquals(guest.pending.size, 0);
  assert(revealPeerChanges(guest, drainTileChanges(world)));
  assertEquals(guest.sight.sample, "");
  publish();
  assert(guest.sight.visible.has(beyondWall));
});

Deno.test("out-of-sight changes keep entity memory and cached sight", () => {
  const guest = {
    mode: "entity" as const,
    sight: { ...createVisibility(), sample: "7,8,0" },
    remembered: new Map<string, Uint8Array>(),
    master: new Map<string, Uint8Array>(),
    pending: createPendingReveal(),
  };
  assertEquals(
    revealPeerChanges(guest, [{ x: 9, y: 8, z: 0, material: OPEN }]),
    false,
  );
  assertEquals(guest.sight.sample, "7,8,0");
  assertEquals(guest.remembered.size, 0);
});
