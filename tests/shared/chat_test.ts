import { assert, assertEquals } from "@std/assert";
import {
  chatBand,
  chatView,
  liveBubbles,
  parseTextSize,
  receiveChat,
  TEXT_SIZE_SCALE,
  thoughtDotLifts,
  withoutChat,
} from "../../src/shared/chat.js";
import {
  addPlayer,
  advanceTicks,
  bubbleTicks,
  createWorld,
  submitMessage,
} from "../../src/shared/world.js";

Deno.test("chat range uses flat distance, four z levels, and threshold buffer", () => {
  const world = createWorld();
  const listener = addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  const speaker = addPlayer(world, "speaker", { x: 3, y: 4, z: 4 });
  assertEquals(chatBand(listener, speaker, undefined), "text");
  speaker.x = 5.05;
  speaker.y = 0;
  assertEquals(chatBand(listener, speaker, "text"), "text");
  assertEquals(chatBand(listener, speaker, undefined), "talking");
  speaker.x = 12.05;
  assertEquals(chatBand(listener, speaker, "talking"), "talking");
  speaker.z = 5;
  assertEquals(chatBand(listener, speaker, "talking"), "none");
});

Deno.test("chat feed filters text and typing separately from entity records", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  const speaker = addPlayer(world, "speaker", { x: 3, y: 4, z: 0 });
  speaker.typing = true;
  submitMessage(world, "speaker", "secret words");
  const bands = new Map();
  assertEquals(chatView(world, "listener", bands)[0].text, "secret words");
  speaker.x = 6;
  const talking = chatView(world, "listener", bands)[0];
  assertEquals(talking.talking, true);
  assertEquals(talking.text, undefined);
  assertEquals(talking.typing, undefined);
  speaker.x = 13;
  assertEquals(chatView(world, "listener", bands), []);
  speaker.x = 4;
  speaker.y = 0;
  speaker.message = "";
  speaker.typing = true;
  assertEquals(chatView(world, "listener", bands)[0].typing, true);
  const clean = withoutChat(world.players);
  assertEquals(clean.speaker.message, "");
  assertEquals(clean.speaker.typing, false);
  assertEquals(clean.speaker.messageUntil, 0);
  assert(world.players.speaker.typing);
});

Deno.test("message deadline stays fixed as range changes", () => {
  const first = receiveChat(
    [],
    [{ id: "speaker", x: 1, y: 1, z: 0, talking: true, expiresTick: 100 }],
    50,
    1000,
  );
  assertEquals(first[0].expiresAt, 3500);
  const second = receiveChat(
    first,
    [{ id: "speaker", x: 1, y: 1, z: 0, text: "hello", expiresTick: 100 }],
    60,
    1800,
  );
  assertEquals(second[0].expiresAt, 3500);
  assertEquals(
    receiveChat(
      second,
      [{ id: "speaker", x: 1, y: 1, z: 0, text: "hello", expiresTick: 100 }],
      100,
      3500,
    ),
    [],
  );
});

Deno.test("thought bubble dots rise in turn and loop", () => {
  assertEquals(thoughtDotLifts(0), thoughtDotLifts(1200));
  const [first, second, third] = thoughtDotLifts(240);
  assertEquals(first > 0.99, true);
  assertEquals(second > 0 && second < first, true);
  assertEquals(third, 0);
  for (let now = 0; now < 2400; now += 7) {
    for (const lift of thoughtDotLifts(now)) {
      assertEquals(lift >= 0 && lift <= 1, true);
    }
  }
});

Deno.test("a speaker keeps the three newest bubbles, each lasting five seconds plus long-message time", () => {
  const world = createWorld();
  addPlayer(world, "speaker", { x: 0, y: 0, z: 0 });
  const long = "x".repeat(100);
  for (const text of ["one", "two", "three", "four"]) {
    submitMessage(world, "speaker", text);
    world.tick += 30;
  }
  world.tick -= 30;
  const speaker = world.players.speaker;
  assertEquals(speaker.messages?.map((bubble) => bubble.text), [
    "two",
    "three",
    "four",
  ]);
  assertEquals(speaker.message, "four");
  assertEquals(speaker.messages?.[2].until, 190);
  world.tick = 120;
  submitMessage(world, "speaker", long);
  assertEquals(speaker.messages?.[2].until, 280);
  assertEquals(bubbleTicks("short"), 100);
  assertEquals(bubbleTicks(long), 160);
});

Deno.test("older bubbles expire first and chat view lists them oldest to newest", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  addPlayer(world, "speaker", { x: 2, y: 0, z: 0 });
  submitMessage(world, "speaker", "first");
  world.tick = 30;
  submitMessage(world, "speaker", "second");
  world.tick = 40;
  submitMessage(world, "speaker", "third");
  const [record] = chatView(world, "listener", new Map());
  assertEquals(record.bubbles?.map((bubble) => bubble.text), [
    "first",
    "second",
    "third",
  ]);
  assertEquals(record.text, "third");
  world.tick = 100;
  advanceTicks(world);
  assertEquals(world.players.speaker.messages?.map((b) => b.text), [
    "second",
    "third",
  ]);
});

Deno.test("talking records and far speakers carry no bubble text", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  addPlayer(world, "speaker", { x: 8, y: 0, z: 0 });
  submitMessage(world, "speaker", "private");
  const [record] = chatView(world, "listener", new Map());
  assertEquals(record.talking, true);
  assertEquals(record.bubbles, undefined);
  assertEquals(liveBubbles(record, 0), []);
});

Deno.test("receiveChat times each bubble and liveBubbles drops expired ones", () => {
  const incoming = [{
    id: "a",
    x: 0,
    y: 0,
    z: 0,
    text: "new",
    expiresTick: 40,
    bubbles: [
      { text: "old", expiresTick: 10 },
      { text: "new", expiresTick: 40 },
    ],
  }];
  const [record] = receiveChat([], incoming, 0, 1000);
  assertEquals(liveBubbles(record, 1100), ["old", "new"]);
  assertEquals(liveBubbles(record, 1600), ["new"]);
  assertEquals(liveBubbles(record, 3100), []);
});

Deno.test("text size parses stored values and defaults to medium at two thirds", () => {
  assertEquals(parseTextSize("small"), "small");
  assertEquals(parseTextSize("large"), "large");
  assertEquals(parseTextSize(null), "medium");
  assertEquals(parseTextSize("huge"), "medium");
  assert(TEXT_SIZE_SCALE.small < TEXT_SIZE_SCALE.medium);
  assert(TEXT_SIZE_SCALE.medium < TEXT_SIZE_SCALE.large);
  assertEquals(TEXT_SIZE_SCALE.medium, 2 / 3);
});

Deno.test("a speaker walking out of text range and back keeps one startTick and startAt", () => {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  const speaker = addPlayer(world, "speaker", { x: 3, y: 0, z: 0 });
  submitMessage(world, "speaker", "hello there");
  advanceTicks(world, 2);
  const bands = new Map();
  const view = (speakerX: number) => {
    speaker.x = speakerX;
    return chatView(world, "listener", bands)[0];
  };
  const text = view(3);
  const talking = view(8);
  const back = view(3);
  assertEquals(talking.talking, true);
  const startTick = text.bubbles![0].startTick!;
  assertEquals(talking.startTick, startTick);
  assertEquals(back.bubbles![0].startTick, startTick);

  const now = 10_000;
  /** Receive a record on a client that keeps its feed between packets. */
  let feed = receiveChat([], [text], world.tick, now);
  const textAt = feed[0].bubbles![0].startAt;
  assert(textAt !== undefined);
  feed = receiveChat(feed, [talking], world.tick, now + 500);
  assertEquals(feed[0].startAt, textAt);
  feed = receiveChat(feed, [back], world.tick, now + 1000);
  assertEquals(feed[0].bubbles![0].startAt, textAt);
  // A talking record that arrives first gives the later text the same start.
  const first = receiveChat([], [talking], world.tick, now);
  assertEquals(first[0].startAt, textAt);
  const later = receiveChat(first, [back], world.tick, now + 500);
  assertEquals(later[0].bubbles![0].startAt, first[0].startAt);
});
