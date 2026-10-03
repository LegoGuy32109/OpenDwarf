import { assert, assertEquals } from "@std/assert";
import { addPlayer, createWorld } from "../../src/shared/world.js";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { createVisibility } from "../../src/shared/visibility.js";
import { packVisibility } from "../../src/shared/visibility-wire.js";
import {
  decodeChat,
  decodeControl,
  decodeMotion,
  decodeState,
  encodeMotionPlayers,
  encodeWorld,
  MAX_PACKET_BYTES,
  parsePacket,
} from "../../src/shared/wire.js";

Deno.test("wire parser rejects malformed, non-string and UTF8 oversized payloads", () => {
  assertEquals(parsePacket('{"type":"resync"}'), { type: "resync" });
  assertEquals(parsePacket("{"), null);
  assertEquals(parsePacket("null"), null);
  assertEquals(parsePacket("[]"), null);
  assertEquals(parsePacket({ type: "resync" }), null);
  assertEquals(
    parsePacket(JSON.stringify({ text: "x".repeat(MAX_PACKET_BYTES) })),
    null,
  );
  const unicode = JSON.stringify({ text: "🙂".repeat(MAX_PACKET_BYTES / 3) });
  assert(unicode.length < MAX_PACKET_BYTES);
  assert(new TextEncoder().encode(unicode).byteLength > MAX_PACKET_BYTES);
  assertEquals(parsePacket(unicode), null);
});

function snapshot(edge = 16) {
  const world = createAuthoredWorld(edge);
  addPlayer(world, "guest");
  return {
    type: "state" as const,
    attempt: "attempt-1",
    viewRevision: 1,
    sightRevision: 2,
    acknowledgedSequence: 0,
    mode: "entity" as "entity" | "master",
    playerId: "guest",
    world: encodeWorld(world),
    visibility: packVisibility(createVisibility()) as
      | ReturnType<typeof packVisibility>
      | null,
    chat: [] as Array<{
      id: string;
      x: number;
      y: number;
      z: number;
      text?: string;
      expiresTick?: number;
    }>,
  };
}

Deno.test("wire snapshots validate both authored areas and master mode", () => {
  for (const edge of [16, 32]) {
    const packet = snapshot(edge);
    assert(decodeState(packet));
    packet.mode = "master";
    assertEquals(decodeState(packet), null);
    packet.visibility = null;
    assert(decodeState(packet));
  }
});

Deno.test("wire full-state rejection is atomic for terrain, masks and entities", () => {
  const valid = snapshot();
  const chunk = valid.world.chunks["0,0"];
  const invalid = [
    { ...valid, world: { ...valid.world, chunks: { "0,0": "AQE=" } } },
    { ...valid, world: { ...valid.world, chunks: { "0,0": "AwD/" } } },
    { ...valid, world: { ...valid.world, chunks: { "00,0": chunk } } },
    { ...valid, world: { ...valid.world, chunks: { "-0,0": chunk } } },
    { ...valid, world: { ...valid.world, chunks: { "9999999,0": chunk } } },
    { ...valid, world: { ...valid.world, chunks: ["0,0"] } },
    { ...valid, visibility: { ...valid.visibility, memory: "broken mask" } },
    {
      ...valid,
      visibility: { ...valid.visibility, memory: { "0,0": "AA==" } },
    },
    { ...valid, playerId: "missing" },
    {
      ...valid,
      world: {
        ...valid.world,
        players: {
          guest: { ...valid.world.players.guest, x: NaN },
        },
      },
    },
  ];
  const before = structuredClone(valid);
  for (const value of invalid) assertEquals(decodeState(value), null);
  assertEquals(valid, before);
  const parsed = decodeState({
    ...valid,
    hidden: "omit",
    world: { ...valid.world, simulation: "omit" },
  });
  assert(parsed);
  assertEquals(Object.hasOwn(parsed, "hidden"), false);
  assertEquals(Object.hasOwn(parsed.world, "simulation"), false);
});

Deno.test("wire rejects coercion, nonfinite positions and unsafe counters", () => {
  const valid = snapshot();
  const motion = {
    type: "motion",
    attempt: valid.attempt,
    viewRevision: 1,
    sightRevision: 2,
    tick: 100,
    acknowledgedSequence: 20,
    players: valid.world.players,
  };
  assert(decodeMotion(motion));
  for (const tick of [Infinity, NaN, -1, 1.5, "100", 2 ** 53]) {
    assertEquals(decodeMotion({ ...motion, tick }), null);
  }
  for (const x of [Infinity, NaN, "7", -(2 ** 24) - 1, 2 ** 24 + 1]) {
    assertEquals(
      decodeMotion({
        ...motion,
        players: {
          guest: { ...valid.world.players.guest, x },
        },
      }),
      null,
    );
  }
  assertEquals(decodeMotion({ ...motion, attempt: "" }), null);
  assertEquals(decodeMotion({ ...motion, sightRevision: -1 }), null);
  assertEquals(
    decodeMotion({
      ...motion,
      players: {
        guest: { ...valid.world.players.guest, z: 0.5 },
      },
    }),
    null,
  );
});

Deno.test("motion has full coordinate precision and strips simulation/chat fields", () => {
  const world = createWorld();
  const player = addPlayer(world, "guest");
  Object.assign(player, {
    x: 7.123456789,
    previousX: 6,
    previousY: 7,
    message: "private text",
    typing: true,
    messageUntil: 100,
    free: true,
    vx: 0.2,
    vy: 0,
  });
  const encoded = encodeMotionPlayers(world.players);
  assertEquals(encoded.guest.x, 7.123456789);
  for (
    const field of [
      "previousX",
      "previousY",
      "message",
      "typing",
      "messageUntil",
    ]
  ) {
    assertEquals(Object.hasOwn(encoded.guest, field), false);
  }
  const decoded = decodeMotion({
    type: "motion",
    attempt: "attempt",
    viewRevision: 0,
    sightRevision: 0,
    tick: 0,
    acknowledgedSequence: 0,
    players: encoded,
  });
  assert(decoded);
  assertEquals(decoded.players.guest.message, "");
  assertEquals(decoded.players.guest.typing, false);
  assertEquals(decoded.players.guest.x, player.x);
});

Deno.test("motion rejects invalid stair moves and entity key mismatches", () => {
  const valid = snapshot();
  const motion = {
    type: "motion",
    attempt: "attempt",
    viewRevision: 0,
    sightRevision: 0,
    tick: 0,
    acknowledgedSequence: 0,
    players: valid.world.players,
  };
  const move = {
    origin: { x: 7, y: 7, z: 0 },
    target: { x: 8, y: 7, z: 1 },
    startPosition: { x: 7.4, y: 7, z: 0 },
    startTick: 0,
    durationTicks: 10,
    sequence: 0,
  };
  assert(
    decodeMotion({
      ...motion,
      players: { guest: { ...valid.world.players.guest, move } },
    }),
  );
  assertEquals(
    decodeMotion({
      ...motion,
      players: {
        guest: {
          ...valid.world.players.guest,
          move: { ...move, durationTicks: 0 },
        },
      },
    }),
    null,
  );
  assertEquals(
    decodeMotion({
      ...motion,
      players: {
        guest: {
          ...valid.world.players.guest,
          move: { ...move, target: { x: 8, y: 7, z: Infinity } },
        },
      },
    }),
    null,
  );
  assertEquals(
    decodeMotion({
      ...motion,
      players: { guest: { ...valid.world.players.guest, id: "other" } },
    }),
    null,
  );
});

Deno.test("chat validates each record and does not accept client expiry clocks", () => {
  const record = {
    id: "speaker",
    x: 7,
    y: 7,
    z: 4,
    text: "hello",
    expiresTick: 100,
  };
  const packet = {
    type: "chat",
    attempt: "attempt",
    viewRevision: 0,
    sightRevision: 0,
    tick: 1,
    chat: [record],
  };
  assert(decodeChat(packet));
  const localClock = decodeChat({
    ...packet,
    chat: [{ ...record, expiresAt: Infinity, name: "hidden name" }],
  });
  assert(localClock);
  assertEquals(Object.hasOwn(localClock.chat[0], "expiresAt"), false);
  assertEquals(Object.hasOwn(localClock.chat[0], "name"), false);
  for (
    const bad of [
      { ...record, text: "x".repeat(121) },
      { ...record, expiresTick: undefined },
      { ...record, expiresTick: -1 },
      { ...record, text: undefined },
      { ...record, z: 9 },
      { ...record, bubbles: [{ text: "", expiresTick: 5 }] },
      { ...record, bubbles: Array(4).fill({ text: "a", expiresTick: 5 }) },
      { ...record, bubbles: [{ text: "a", expiresTick: -1 }] },
      { ...record, text: undefined, talking: true, bubbles: [] },
    ]
  ) assertEquals(decodeChat({ ...packet, chat: [bad] }), null);
  const stacked = decodeChat({
    ...packet,
    chat: [{
      ...record,
      bubbles: [{ text: "hi", expiresTick: 90, hidden: 1 }, {
        text: "hello",
        expiresTick: 100,
      }],
    }],
  });
  assertEquals(stacked?.chat[0].bubbles, [
    { text: "hi", expiresTick: 90 },
    { text: "hello", expiresTick: 100 },
  ]);
  assertEquals(decodeChat({ ...packet, chat: [record, record] }), null);
  const state = snapshot();
  state.chat = [{ ...record, x: NaN }];
  assertEquals(decodeState(state), null);
});

Deno.test("control requires integer octants, bounded strings, and proper types", () => {
  assert(decodeControl({ type: "input", dx: 0, dy: 0, sequence: 20 }));
  assert(decodeControl({
    type: "input",
    dx: 0,
    dy: 0,
    sequence: 20,
    sprint: true,
  }));
  assertEquals(
    decodeControl({ type: "input", dx: 0, dy: 0, sequence: 20, sprint: 1 }),
    null,
  );
  assert(decodeControl({ type: "ping", id: "ping-id" }));
  assert(decodeControl({ type: "resync" }));
  for (
    const value of [
      { type: "input", dx: 0.1, dy: 0, sequence: 20 },
      { type: "input", dx: "1", dy: 0, sequence: 20 },
      { type: "input", dx: 1, dy: 0, sequence: -1 },
      { type: "typing", typing: "true" },
      { type: "message", text: "x".repeat(121) },
      { type: "mode", mode: "admin" },
      { type: "unknown" },
      null,
    ]
  ) assertEquals(decodeControl(value), null);
});

Deno.test("wire state requires an own local-player entry", () => {
  const value = snapshot();
  for (const playerId of ["toString", "hasOwnProperty", "__defineGetter__"]) {
    assertEquals(decodeState({ ...value, playerId }), null);
  }
});
