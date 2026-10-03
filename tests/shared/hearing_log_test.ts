import { assertEquals } from "@std/assert";
import { chatView } from "../../src/shared/chat.js";
import {
  addSystemLine,
  createHearingLog,
  hearChat,
  HEARING_LOG_LIMIT,
} from "../../src/shared/hearing-log.js";
import {
  addPlayer,
  createWorld,
  submitMessage,
} from "../../src/shared/world.js";

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
  submitMessage(world, "near", "second");
  hearChat(log, chatView(world, "listener", new Map()), (id) => id);
  hearChat(log, chatView(world, "listener", new Map()), (id) => id);
  assertEquals(log.lines.map((line) => line.text), ["first", "second"]);
});
