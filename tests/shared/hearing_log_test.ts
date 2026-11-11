import { assert, assertEquals } from "@std/assert";
import { chatView } from "../../src/shared/chat.js";
import {
  addSystemLine,
  createHearingLog,
  hearChat,
  HEARING_LOG_LIMIT,
} from "../../src/shared/hearing-log.js";
import { addPlayer, submitMessage } from "../../src/shared/world.js";
import { createFixtureWorld as createWorld } from "../../src/shared/world-builder.js";

const nameOf = (id: string) => id;

Deno.test("hearing log keeps messages inside hearing range and drops the rest", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  addPlayer(world, "near", { x: 3, y: 0, z: 0 });
  addPlayer(world, "talking", { x: 8, y: 0, z: 0 });
  addPlayer(world, "far", { x: 20, y: 0, z: 0 });
  addPlayer(world, "above", { x: 1, y: 0, z: 5 });
  for (const id of ["near", "talking", "far", "above"]) {
    submitMessage(world, id, `from ${id}`);
  }
  const log = createHearingLog();
  hearChat(log, chatView(world, "listener", new Map()), nameOf);
  assertEquals(log.lines, [
    { kind: "chat", text: "from near", speaker: "near" },
  ]);
});

Deno.test("hearing log records a message once while its bubble stays active", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  addPlayer(world, "near", { x: 3, y: 0, z: 0 });
  const bands = new Map();
  const log = createHearingLog();
  submitMessage(world, "near", "hello");
  hearChat(log, chatView(world, "listener", bands), nameOf);
  hearChat(log, chatView(world, "listener", bands), nameOf);
  world.tick = 50;
  submitMessage(world, "near", "again");
  hearChat(log, chatView(world, "listener", bands), nameOf);
  assertEquals(log.lines.map((line) => line.text), ["hello", "again"]);
});

Deno.test("a speaker who walks out of range is not logged until in range", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  const speaker = addPlayer(world, "speaker", { x: 9, y: 0, z: 0 });
  const bands = new Map();
  const log = createHearingLog();
  submitMessage(world, "speaker", "psst");
  hearChat(log, chatView(world, "listener", bands), nameOf);
  assertEquals(log.lines, []);
  speaker.x = 2;
  hearChat(log, chatView(world, "listener", bands), nameOf);
  assertEquals(log.lines.map((line) => line.text), ["psst"]);
});

Deno.test("system lines share the log, are trimmed, and the log is bounded", () => {
  const log = createHearingLog();
  addSystemLine(log, "  Ada   joined ");
  addSystemLine(log, "   ");
  assertEquals(log.lines, [{ kind: "system", text: "Ada joined" }]);
  for (let i = 0; i < HEARING_LOG_LIMIT + 5; i++) addSystemLine(log, `n${i}`);
  assertEquals(log.lines.length, HEARING_LOG_LIMIT);
  assertEquals(log.lines.at(-1)?.text, `n${HEARING_LOG_LIMIT + 4}`);
});

Deno.test("hearing log keeps every stacked message that arrives in one update", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 1, y: 1, z: 0 });
  addPlayer(world, "near", { x: 2, y: 1, z: 0 });
  const log = createHearingLog();
  submitMessage(world, "near", "first");
  world.tick = 20;
  submitMessage(world, "near", "second");
  hearChat(log, chatView(world, "listener", new Map()), (id) => id);
  hearChat(log, chatView(world, "listener", new Map()), (id) => id);
  assertEquals(log.lines.map((line) => line.text), ["first", "second"]);
});

Deno.test("hearing log joins ordered pieces into one line as they start", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  addPlayer(world, "speaker", { x: 2, y: 0, z: 0 });
  const log = createHearingLog();
  const bands = new Map();
  const text =
    "a long message that needs several separate pieces to speak aloud";
  submitMessage(world, "speaker", text);
  const pieces = world.players.speaker.messages!;
  for (const piece of pieces) {
    world.tick = piece.start!;
    hearChat(log, chatView(world, "listener", bands), (id) => id);
  }
  assertEquals(log.lines.filter((line) => line.kind === "chat").length, 1);
  assertEquals(log.lines[0].text, text);
});

Deno.test("hearing log removes inserted hyphens but keeps authored hyphens", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  addPlayer(world, "speaker", { x: 2, y: 0, z: 0 });
  const log = createHearingLog();
  const text = `${"x".repeat(80)} with an authored-hyphen`;
  submitMessage(world, "speaker", text);
  for (const piece of world.players.speaker.messages!) {
    world.tick = piece.start!;
    hearChat(log, chatView(world, "listener", new Map()), (id) => id);
  }
  assertEquals(log.lines[0].text, text);
});

Deno.test("hearing log resumes a message after an unheard gap", () => {
  const world = createWorld();
  const listener = addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  addPlayer(world, "speaker", { x: 2, y: 0, z: 0 });
  const log = createHearingLog();
  submitMessage(world, "speaker", "mountain".repeat(30));
  const pieces = world.players.speaker.messages!;
  world.tick = pieces[0].start!;
  hearChat(log, chatView(world, "listener", new Map()), nameOf);
  listener.x = 20;
  world.tick = Math.max(pieces[3].start!, pieces[2].until);
  hearChat(log, chatView(world, "listener", new Map()), nameOf);
  listener.x = 2;
  hearChat(log, chatView(world, "listener", new Map()), nameOf);
  for (const piece of pieces.slice(4)) {
    world.tick = piece.start!;
    hearChat(log, chatView(world, "listener", new Map()), nameOf);
  }
  const audible = [pieces[0], ...pieces.slice(3)].map((piece) =>
    piece.softHyphen ? piece.text.slice(0, -1) : piece.text
  ).join("");
  assertEquals(log.lines[0].text, audible);
});

Deno.test("incomplete hearing groups stay bounded and leave no evicted lines retained", () => {
  const log = createHearingLog();
  const feed = Array.from({ length: 1000 }, (_, index) => ({
    id: `speaker-${index}`,
    x: 0,
    y: 0,
    z: 0,
    text: "first",
    expiresTick: 50,
    bubbles: [{
      text: "first",
      expiresTick: 50,
      group: index,
      part: 0,
      parts: 5,
    }],
  }));
  hearChat(log, feed, nameOf);
  assertEquals(log.lines.length, HEARING_LOG_LIMIT);
  assertEquals(log.groups.size, HEARING_LOG_LIMIT);
  assert(log.heard.size <= 400);
  const retainedLines = new Set(log.lines);
  assert([...log.groups.values()].every(({ line }) => retainedLines.has(line)));
});
