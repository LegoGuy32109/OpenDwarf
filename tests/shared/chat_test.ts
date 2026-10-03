import { assert, assertEquals } from "@std/assert";
import {
  chatBand,
  chatView,
  receiveChat,
  thoughtDotLifts,
  withoutChat,
} from "../../src/shared/chat.js";
import {
  addPlayer,
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
