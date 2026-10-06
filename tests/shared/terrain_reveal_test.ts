// Pending reveal and incremental terrain sync (ADR 0005).
import { assert, assertEquals } from "@std/assert";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { createChunkGenerator } from "../../src/shared/generation.js";
import {
  applyReveal,
  createPendingReveal,
  drainReveal,
  markAllPending,
  revealChanges,
  syncLoadedChunks,
} from "../../src/shared/reveal.js";
import {
  decodeChunks,
  MAX_REVEAL_CHUNKS,
} from "../../src/shared/chunk-wire.js";
import {
  CHUNK_CELLS,
  chunkIndex,
  chunkKey,
  drainTileChanges,
  ensureChunk,
  OPEN,
  readTile,
  STONE,
  UNKNOWN,
  writeTile,
} from "../../src/shared/terrain.js";
import { entityView } from "../../src/shared/view.js";
import { createVisibility, tileKey } from "../../src/shared/visibility.js";
import { addPlayer } from "../../src/shared/world.js";
import {
  decodeState,
  encodeWorld,
  MAX_PACKET_BYTES,
} from "../../src/shared/wire.js";

/** One guest as the world host keeps it. */
function hostGuest() {
  return {
    mode: "entity" as "entity" | "master",
    sight: createVisibility(),
    remembered: new Map<string, Uint8Array>(),
    master: new Map<string, Uint8Array>(),
    pending: createPendingReveal(),
  };
}

type Guest = ReturnType<typeof hostGuest>;

/** What the host sends for the next state packet: the reveal, decoded as the guest decodes it. */
function nextReveal(
  world: ReturnType<typeof createAuthoredWorld>,
  guest: Guest,
  viewerId = "guest",
) {
  entityView(world, viewerId, guest.sight, guest.remembered, guest.pending);
  return decodeChunks(drainReveal(guest.remembered, guest.pending))!;
}

function tilesIn(reveal: Map<string, Uint8Array>) {
  let count = 0;
  for (const chunk of reveal.values()) {
    for (const material of chunk) if (material !== UNKNOWN) count++;
  }
  return count;
}

Deno.test("a reveal holds only the tiles that changed since the last packet", () => {
  const world = createAuthoredWorld();
  addPlayer(world, "guest", { x: 7, y: 8, z: 0 });
  const guest = hostGuest();
  const first = nextReveal(world, guest);
  assert(tilesIn(first) > 0, "the first reveal holds what the guest sees");
  assertEquals(nextReveal(world, guest).size, 0, "nothing changed");
  // Mining a visible tile marks that tile and no other.
  writeTile(world, 6, 8, 0, STONE);
  assert(revealChanges(guest, drainTileChanges(world)));
  const after = nextReveal(world, guest);
  assertEquals(tilesIn(after), 1);
  assertEquals(after.get("0,0")![chunkIndex(6, 8, 0)], STONE);
});

Deno.test("material 0 leaves the guest's tile unchanged", () => {
  const guestWorld = { chunks: new Map<string, Uint8Array>() };
  const full = new Uint8Array(CHUNK_CELLS).fill(OPEN);
  applyReveal(guestWorld, new Map([["0,0", full]]));
  const delta = new Uint8Array(CHUNK_CELLS).fill(UNKNOWN);
  delta[5] = STONE;
  applyReveal(guestWorld, new Map([["0,0", delta]]));
  const chunk = guestWorld.chunks.get("0,0")!;
  assertEquals(chunk[5], STONE);
  assertEquals(chunk[6], OPEN);
  assertEquals(chunk[CHUNK_CELLS - 1], OPEN);
});

Deno.test("a packet holds at most MAX_REVEAL_CHUNKS chunks and the rest go out next", () => {
  const remembered = new Map<string, Uint8Array>();
  const pending = createPendingReveal();
  const total = MAX_REVEAL_CHUNKS + 8;
  for (let i = 0; i < total; i++) {
    remembered.set(chunkKey(i, 0), new Uint8Array(CHUNK_CELLS).fill(STONE));
    pending.set(chunkKey(i, 0), true);
  }
  const first = Object.keys(drainReveal(remembered, pending));
  assertEquals(first.length, MAX_REVEAL_CHUNKS);
  assertEquals(pending.size, 8);
  const second = Object.keys(drainReveal(remembered, pending));
  assertEquals(second.length, 8);
  assertEquals(new Set([...first, ...second]).size, total);
  assertEquals(pending.size, 0);
});

Deno.test("a full packet stays well under the packet cap", () => {
  const remembered = new Map<string, Uint8Array>();
  const pending = createPendingReveal();
  for (let i = 0; i < MAX_REVEAL_CHUNKS; i++) {
    // Alternate materials so run-length encoding gains nothing: the worst case.
    const noisy = new Uint8Array(CHUNK_CELLS).map((_, j) =>
      j % 2 ? STONE : OPEN
    );
    remembered.set(chunkKey(i, 0), noisy);
    pending.set(chunkKey(i, 0), true);
  }
  const bytes = JSON.stringify(drainReveal(remembered, pending)).length;
  assert(bytes < MAX_PACKET_BYTES, `${bytes} bytes`);
});

Deno.test("a rejoin resends everything the host holds for the guest", () => {
  const world = createAuthoredWorld();
  addPlayer(world, "guest", { x: 7, y: 8, z: 0 });
  const guest = hostGuest();
  const guestWorld = { chunks: new Map<string, Uint8Array>() };
  applyReveal(guestWorld, nextReveal(world, guest));
  assertEquals(nextReveal(world, guest).size, 0);
  // The guest starts over with an empty copy; the host marks all it holds.
  guestWorld.chunks = new Map();
  markAllPending(guest.pending, guest.remembered);
  applyReveal(guestWorld, nextReveal(world, guest));
  assertEquals([...guestWorld.chunks.keys()], [...guest.remembered.keys()]);
  for (const [key, chunk] of guest.remembered) {
    assertEquals(guestWorld.chunks.get(key), chunk);
  }
});

Deno.test("a mined tile reaches a guest that sees it, but not one that does not", () => {
  const world = createAuthoredWorld();
  addPlayer(world, "near", { x: 7, y: 8, z: 0 });
  addPlayer(world, "far", { x: 14, y: 1, z: 0 });
  const near = hostGuest();
  const far = hostGuest();
  nextReveal(world, near, "near");
  nextReveal(world, far, "far");
  const target = { x: 6, y: 8, z: 0 };
  assert(near.sight.visible.has(tileKey(target.x, target.y, target.z)));
  assert(!far.sight.visible.has(tileKey(target.x, target.y, target.z)));
  writeTile(world, target.x, target.y, target.z, STONE);
  const changes = drainTileChanges(world);
  assertEquals(revealChanges(near, changes), true);
  assertEquals(revealChanges(far, changes), false);
  assertEquals(far.pending.size, 0);
  const seen = decodeChunks(drainReveal(near.remembered, near.pending))!;
  assertEquals(seen.get("0,0")![chunkIndex(6, 8, 0)], STONE);
});

Deno.test("master view sends the loaded chunks near the player and no others", () => {
  const world = createAuthoredWorld();
  // Authored chunk 0,0 is loaded. 2,0 is within reach and loaded; 1,0 is
  // within reach but unloaded; 9,0 is loaded but far away.
  ensureChunk(world, 2, 0);
  ensureChunk(world, 9, 0);
  const guest = hostGuest();
  guest.mode = "master";
  syncLoadedChunks(world, guest.master, guest.pending, 0, 0);
  const reveal = decodeChunks(drainReveal(guest.master, guest.pending))!;
  assertEquals([...reveal.keys()].sort(), ["0,0", "2,0"]);
  // Sent in full, with no sight filter: every tile of a chunk is present.
  assertEquals(reveal.get("2,0"), world.chunks.get("2,0"));
  // A change in a held chunk follows; one in an unloaded chunk is ignored.
  writeTile(world, 3, 3, 0, STONE);
  assert(revealChanges(guest, drainTileChanges(world)));
  assertEquals(
    tilesIn(decodeChunks(drainReveal(guest.master, guest.pending))!),
    1,
  );
  assertEquals(
    syncLoadedChunks(world, guest.master, guest.pending, 0, 0),
    undefined,
  );
  assertEquals(guest.pending.size, 0, "nothing new to send");
});

Deno.test("a guest that walks across 40 chunks and back keeps its packets bounded", () => {
  const world = createAuthoredWorld();
  world.generateChunk = createChunkGenerator(20260606);
  const player = addPlayer(world, "guest", { x: 8, y: 8, z: 0 });
  const guest = hostGuest();
  const guestWorld = { chunks: new Map<string, Uint8Array>() };
  const sizes: number[] = [];
  const step = (x: number) => {
    player.x = x;
    // The host generates ahead of the player, as its loop does.
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        ensureChunk(world, Math.floor(x / 16) + dx, dy);
      }
    }
    for (let drained = false; !drained;) {
      const view = entityView(
        world,
        "guest",
        guest.sight,
        guest.remembered,
        guest.pending,
      );
      const reveal = drainReveal(guest.remembered, guest.pending);
      const packet = JSON.stringify({
        type: "state",
        attempt: "a",
        viewRevision: 1,
        sightRevision: 1,
        acknowledgedSequence: 0,
        mode: "entity",
        playerId: "guest",
        world: encodeWorld(view.world),
        reveal,
        visibility: view.visibility,
        chat: [],
      });
      sizes.push(packet.length);
      const decoded = decodeState(JSON.parse(packet));
      assert(decoded, "the packet decodes");
      applyReveal(guestWorld, decoded.reveal);
      drained = guest.pending.size === 0;
    }
  };
  // 45 chunks out along x, then back to the start.
  for (let x = 8; x < 45 * 16; x += 4) step(x);
  assert(guest.remembered.size > 40, `${guest.remembered.size} chunks`);
  const out = sizes.length;
  for (let x = 45 * 16; x >= 8; x -= 4) step(x);
  assert(sizes.length > out);
  // After the first reveal, no packet grows with how far the guest has gone.
  const steady = sizes.slice(4);
  assert(
    Math.max(...steady) < 32 * 1024,
    `largest packet ${Math.max(...steady)} bytes`,
  );
  // The guest's copy matches what the host remembers for it.
  assertEquals(guestWorld.chunks.size, guest.remembered.size);
  for (const [key, chunk] of guest.remembered) {
    assertEquals(guestWorld.chunks.get(key), chunk);
  }
  assert(readTile(guestWorld, 8, 8, 0) !== UNKNOWN);
});
