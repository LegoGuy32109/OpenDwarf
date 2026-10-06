// Queued speech, bubble start ticks, and the syllable reveal (ADR 0006).
import { assert, assertEquals } from "@std/assert";
import {
  chatView,
  liveBubbleItems,
  receiveChat,
  withoutChat,
} from "../../src/shared/chat.js";
import { createHearingLog, hearChat } from "../../src/shared/hearing-log.js";
import { syllableCount } from "../../src/shared/speech.js";
import { decodeChat } from "../../src/shared/wire.js";
import {
  addPlayer,
  bubbleTicks,
  createWorld,
  MAX_BUBBLES,
  MAX_QUEUED,
  speechTicks,
  submitMessage,
  TICK_MS,
} from "../../src/shared/world.js";

const LONG = "Found some iron beneath the mountain, come and see it";

function setup(speakerX = 2) {
  const world = createWorld();
  addPlayer(world, "listener", { x: 0, y: 0, z: 0 });
  addPlayer(world, "speaker", { x: speakerX, y: 0, z: 0 });
  return world;
}

const starts = (world: ReturnType<typeof createWorld>) =>
  world.players.speaker.messages?.map((bubble) => bubble.start);

Deno.test("the second and third quick messages start when the previous speech ends", () => {
  const world = setup();
  world.tick = 10;
  for (const text of ["one", LONG, "three"]) {
    assert(submitMessage(world, "speaker", text));
  }
  const first = 10;
  const second = first + speechTicks("one", "speaker");
  const third = second + speechTicks(LONG, "speaker");
  assertEquals(starts(world), [first, second, third]);
  assert(third - second > 60, "a long message takes a while to speak");
});

Deno.test("a message sent after the previous speech ended starts now", () => {
  const world = setup();
  submitMessage(world, "speaker", "one");
  world.tick = 200;
  submitMessage(world, "speaker", "two");
  assertEquals(world.players.speaker.messages?.at(-1)?.start, 200);
});

Deno.test("a bubble expires two seconds after its speech, never before bubbleTicks", () => {
  const world = setup();
  submitMessage(world, "speaker", "hi");
  const [short] = world.players.speaker.messages!;
  assertEquals(short.until, bubbleTicks("hi"));
  assert(speechTicks("hi", "speaker") + 40 < bubbleTicks("hi"));
  world.tick = 500;
  const long = "Welcome, traveler. Something, another. History!";
  assert(speechTicks(long, "speaker") + 40 > bubbleTicks(long));
  submitMessage(world, "speaker", long);
  const bubble = world.players.speaker.messages!.at(-1)!;
  assertEquals(bubble.start, 500);
  assertEquals(bubble.until, 500 + speechTicks(long, "speaker") + 40);
  // A longer text with few syllables still lasts as long as bubbleTicks.
  const dense = "x".repeat(120);
  world.tick = 1000;
  submitMessage(world, "speaker", dense);
  assertEquals(
    world.players.speaker.messages!.at(-1)!.until,
    1000 + bubbleTicks(dense),
  );
});

Deno.test("a queued bubble's text is in no feed before it starts", () => {
  const world = setup();
  submitMessage(world, "speaker", "opening words");
  submitMessage(world, "speaker", "secret second");
  const second = world.players.speaker.messages![1];
  const hidden = (feed: unknown) => !JSON.stringify(feed).includes("secret");
  const bands = new Map();
  world.tick = second.start! - 1;
  assert(hidden(chatView(world, "listener", bands)));
  assert(hidden(chatView(world, "listener", new Map())));
  world.players.speaker.x = 8;
  assert(hidden(chatView(world, "listener", new Map())));
  world.players.speaker.x = 2;
  assert(hidden(withoutChat(world.players)));
  world.tick = second.start!;
  const [record] = chatView(world, "listener", bands);
  assertEquals(record.bubbles?.map((bubble) => bubble.text), [
    "opening words",
    "secret second",
  ]);
  assertEquals(record.bubbles?.[1].startTick, second.start);
  assertEquals(record.queued, undefined);
});

Deno.test("the feed says a message is queued and counts syllables for far listeners", () => {
  const world = setup();
  submitMessage(world, "speaker", "opening words");
  submitMessage(world, "speaker", "second");
  const [near] = chatView(world, "listener", new Map());
  assertEquals(near.queued, true);
  assertEquals(near.bubbles?.map((bubble) => bubble.text), ["opening words"]);
  world.players.speaker.x = 8;
  const [far] = chatView(world, "listener", new Map());
  assertEquals(far.talking, true);
  assertEquals(far.syllables, syllableCount("opening words"));
  assertEquals(far.text, undefined);
  world.tick = world.players.speaker.messages![1].start!;
  const [later] = chatView(world, "listener", new Map());
  assertEquals(later.syllables, syllableCount("second"));
});

Deno.test("typing and queued both show the thought icon", () => {
  const world = setup();
  world.players.speaker.typing = true;
  assertEquals(chatView(world, "listener", new Map())[0].typing, true);
  world.players.speaker.typing = false;
  submitMessage(world, "speaker", "one");
  submitMessage(world, "speaker", "two");
  const [record] = chatView(world, "listener", new Map());
  assertEquals(record.queued, true);
  assertEquals(record.typing, undefined);
});

Deno.test("only started bubbles count toward MAX_BUBBLES, and the queue is bounded", () => {
  const world = setup();
  for (let i = 0; i < MAX_QUEUED + MAX_BUBBLES + 4; i++) {
    submitMessage(world, "speaker", `m${i}`);
  }
  const messages = world.players.speaker.messages!;
  assertEquals(
    messages.filter((b) => b.start! > world.tick).length,
    MAX_QUEUED,
  );
  assertEquals(submitMessage(world, "speaker", "too many"), false);
  // Once the earlier ones have started, at most three started bubbles stay.
  world.tick = messages.at(-1)!.start!;
  submitMessage(world, "speaker", "late");
  const started = world.players.speaker.messages!.filter((b) =>
    b.start! <= world.tick
  );
  assert(started.length <= MAX_BUBBLES);
});

Deno.test("receiveChat turns startTick into a local startAt that stays fixed", () => {
  const incoming = [{
    id: "a",
    x: 0,
    y: 0,
    z: 0,
    text: "hello",
    expiresTick: 200,
    bubbles: [{ text: "hello", expiresTick: 200, startTick: 90 }],
  }];
  const first = receiveChat([], incoming, 100, 1000);
  assertEquals(first[0].bubbles![0].startAt, 1000 - 10 * TICK_MS);
  const again = receiveChat(first, incoming, 105, 1250);
  assertEquals(again[0].bubbles![0].startAt, 1000 - 10 * TICK_MS);
  assertEquals(liveBubbleItems(again[0], 1300)[0].startAt, 500);
});

Deno.test("wire validates startTick, queued, and syllables", () => {
  const packet = {
    type: "chat",
    attempt: "attempt",
    viewRevision: 0,
    sightRevision: 0,
    tick: 1,
  };
  const record = { id: "s", x: 1, y: 1, z: 0, text: "hi", expiresTick: 100 };
  const decode = (item: Record<string, unknown>) =>
    decodeChat({ ...packet, chat: [item] });
  const good = decode({
    ...record,
    queued: true,
    bubbles: [{ text: "hi", expiresTick: 100, startTick: 5 }],
  });
  assertEquals(good?.chat[0].queued, true);
  assertEquals(good?.chat[0].bubbles?.[0].startTick, 5);
  const talking = decode({
    id: "s",
    x: 1,
    y: 1,
    z: 0,
    talking: true,
    syllables: 4,
    expiresTick: 100,
  });
  assertEquals(talking?.chat[0].syllables, 4);
  assert(decode({ id: "s", x: 1, y: 1, z: 0, queued: true }));
  for (
    const bad of [
      { ...record, queued: "yes" },
      { ...record, queued: 1 },
      { ...record, syllables: -1 },
      { ...record, syllables: 1.5 },
      { ...record, syllables: 121 },
      { ...record, syllables: "3" },
      { ...record, bubbles: [{ text: "hi", expiresTick: 100, startTick: -1 }] },
      {
        ...record,
        bubbles: [{ text: "hi", expiresTick: 100, startTick: "x" }],
      },
      { id: "s", x: 1, y: 1, z: 0, queued: false },
    ]
  ) assertEquals(decode(bad), null);
});

Deno.test("the hearing log takes a message only when it starts", () => {
  const world = setup();
  const log = createHearingLog();
  const bands = new Map();
  const hear = () =>
    hearChat(log, chatView(world, "listener", bands), (id) => id);
  submitMessage(world, "speaker", "first");
  submitMessage(world, "speaker", "second");
  hear();
  assertEquals(log.lines.map((line) => line.text), ["first"]);
  const start = world.players.speaker.messages![1].start!;
  world.tick = start - 1;
  hear();
  assertEquals(log.lines.map((line) => line.text), ["first"]);
  world.tick = start;
  hear();
  hear();
  assertEquals(log.lines.map((line) => line.text), ["first", "second"]);
});
