// NPC conversations on the world host: private choices, the reply queue, the
// thinking delay, and who picks the reply line.
import { assert, assertEquals } from "@std/assert";
import {
  BUY_REPLIES,
  createConversations,
  THINK_MAX_MS,
  THINK_MIN_MS,
  thinkingTicks,
} from "../../src/shared/npc-conversation.js";
import {
  addPlayer,
  advanceTicks,
  speechTicks,
  TICK_MS,
} from "../../src/shared/world.js";
import { roomRecipe } from "../../src/shared/world-recipes.js";
import { createSimulation } from "../../src/shared/simulation.js";
import { createOpenField } from "./fixtures.ts";
import { addTrader } from "./fixtures.ts";

const BUYS = "buys";

function setup(random = () => 0) {
  const world = createOpenField();
  const ulgar = addTrader(world, { x: 5, y: 5, z: 0 });
  const ada = addPlayer(world, "ada", { x: 5, y: 6, z: 0 });
  ada.name = "Ada";
  const bo = addPlayer(world, "bo", { x: 4, y: 6, z: 0 });
  bo.name = "Bo";
  const conversations = createConversations(world, random);
  /** Every line Ulgar spoke, in order, with the tick it began. */
  const heard: { tick: number; text: string }[] = [];
  /** Run ticks, logging each tick Ulgar's typing flag and newest spoken line. */
  const run = (ticks: number) => {
    const log: { tick: number; typing: boolean; text: string }[] = [];
    for (let i = 0; i < ticks; i++) {
      advanceTicks(world);
      conversations.step();
      for (const bubble of ulgar.messages ?? []) {
        if (!heard.some((line) => line.tick === bubble.start)) {
          heard.push({ tick: bubble.start ?? 0, text: bubble.text });
        }
      }
      log.push({
        tick: world.tick,
        typing: ulgar.typing,
        text: ulgar.messages?.at(-1)?.text ?? "",
      });
    }
    return log;
  };
  return { world, ulgar, ada, bo, conversations, run, heard };
}

Deno.test("the host picks the reply line, one of the three authored lines", () => {
  assertEquals(BUY_REPLIES.length, 3);
  for (const [roll, index] of [[0, 0], [0.5, 1], [0.99, 2]]) {
    const { conversations, run, heard } = setup(() => roll);
    assert(conversations.ask("ada", "npc-ulgar", BUYS).ok);
    run(400);
    assertEquals(heard.map((line) => line.text), [
      `Ada, ${BUY_REPLIES[index]}`,
    ]);
  }
});

Deno.test("every authored reply reads after the asker's name", () => {
  for (const reply of BUY_REPLIES) {
    assert(/^(I\b|[a-z])/.test(reply), reply);
  }
  const { conversations, run, heard } = setup(() => 0.5);
  conversations.ask("ada", "npc-ulgar", BUYS);
  run(400);
  assertEquals(
    heard[0].text,
    "Ada, anything that glitters out of the rock is ore or gems. Never stone.",
  );
});

Deno.test("a confirmed line is spoken by the asker at once", () => {
  const { conversations, world, run, heard } = setup();
  const asked = conversations.ask("ada", "npc-ulgar", BUYS);
  assertEquals(asked, { ok: true });
  assertEquals(world.players.ada.messages?.map((bubble) => bubble.text), [
    "What do you buy?",
  ]);
  assertEquals(conversations.ask("bo", "npc-ulgar", BUYS), { ok: true });
  run(600);
  assertEquals(heard.length, 2);
  assert(
    heard.every((line) => BUY_REPLIES.some((text) => line.text.endsWith(text))),
  );
});

Deno.test("a reply waits for the asker's line, thinks, then speaks naming the asker", () => {
  const { conversations, ulgar, ada, run } = setup();
  conversations.ask("ada", "npc-ulgar", BUYS);
  const lineEnd = speechTicks("What do you buy?", "ada");
  const log = run(400);
  const thinking = log.filter((entry) => entry.typing);
  assert(thinking.length > 0);
  // Ulgar does not think while Ada is still speaking.
  assert(thinking[0].tick >= lineEnd);
  const spoke = log.find((entry) => entry.text.startsWith("Ada, "))!;
  assert(spoke.tick >= thinking.at(-1)!.tick);
  assertEquals(ulgar.typing, false);
  assertEquals(ada.typing, false);
});

Deno.test("requests are answered one at a time, in order", () => {
  const { conversations, run, heard } = setup();
  assert(conversations.ask("bo", "npc-ulgar", BUYS).ok);
  assert(conversations.ask("ada", "npc-ulgar", BUYS).ok);
  assertEquals(conversations.waiting("npc-ulgar"), ["bo", "ada"]);
  const log = run(900);
  assertEquals(heard.map((line) => line.text.split(",")[0]), ["Bo", "Ada"]);
  const first = log.find((entry) => entry.text.startsWith("Bo, "))!;
  const second = log.find((entry) => entry.text.startsWith("Ada, "))!;
  // Ada's reply starts thinking only after Bo's reply has been spoken.
  const secondThinking = log.filter((entry) =>
    entry.typing && entry.tick > first.tick
  );
  assert(
    secondThinking[0].tick >= first.tick + speechTicks(
          first.text,
          "npc-ulgar",
        ),
  );
  assert(second.tick > first.tick);
});

Deno.test("a player has one unanswered request per NPC", () => {
  const { conversations, run } = setup();
  assert(conversations.ask("ada", "npc-ulgar", BUYS).ok);
  const again = conversations.ask("ada", "npc-ulgar", BUYS);
  assertEquals(again, { ok: false, reason: "Ulgar still owes you an answer" });
  assertEquals(conversations.waiting("npc-ulgar"), ["ada"]);
  // Another player is not blocked, and Ada may ask again once answered.
  assert(conversations.ask("bo", "npc-ulgar", BUYS).ok);
  run(900);
  assertEquals(conversations.waiting("npc-ulgar"), []);
  assert(conversations.ask("ada", "npc-ulgar", BUYS).ok);
});

Deno.test("leaving range stops new requests, and a prepared reply still arrives", () => {
  const { conversations, ada, run, heard } = setup();
  assert(conversations.ask("ada", "npc-ulgar", BUYS).ok);
  ada.x = 12;
  ada.y = 12;
  // Out of range, Ada cannot ask again, but the reply being prepared arrives.
  assertEquals(conversations.ask("ada", "npc-ulgar", "sell").ok, false);
  assert(conversations.ask("bo", "npc-ulgar", BUYS).ok);
  run(900);
  assertEquals(heard.map((line) => line.text.split(",")[0]), ["Ada", "Bo"]);
});

Deno.test("only a trader NPC, a known choice, and a real player are accepted", () => {
  const { conversations, world } = setup();
  assertEquals(conversations.ask("nobody", "npc-ulgar", BUYS).ok, false);
  assertEquals(conversations.ask("ada", "ada", BUYS).ok, false);
  assertEquals(conversations.ask("ada", "missing", BUYS).ok, false);
  assertEquals(conversations.ask("ada", "npc-ulgar", "greet").ok, false);
  assertEquals(conversations.ask("ada", {}, BUYS).ok, false);
  assertEquals(conversations.ask("ada", "npc-ulgar", 7).ok, false);
  assertEquals(world.players.ada.messages ?? [], []);
});

Deno.test("I have ore to trade is spoken but takes no reply", () => {
  const { conversations, world, run, heard } = setup();
  assertEquals(conversations.ask("ada", "npc-ulgar", "sell"), { ok: true });
  assertEquals(world.players.ada.messages?.[0].text, "I have ore to trade");
  assertEquals(conversations.waiting("npc-ulgar"), []);
  run(300);
  assertEquals(heard, []);
});

Deno.test("confirming keeps the thought icon the open menu raised", () => {
  const { conversations, ada } = setup();
  ada.typing = true;
  conversations.ask("ada", "npc-ulgar", BUYS);
  assertEquals(ada.typing, true);
});

Deno.test("the thinking delay is one to three seconds and grows with the reply", () => {
  const short = "Ore.";
  const long = BUY_REPLIES[0].repeat(3);
  for (const text of [short, ...BUY_REPLIES, long]) {
    for (const roll of [0, 0.25, 0.5, 0.99, 1]) {
      const ticks = thinkingTicks(text, roll);
      assert(ticks * TICK_MS >= THINK_MIN_MS, `${text} at ${roll}`);
      assert(ticks * TICK_MS <= THINK_MAX_MS + TICK_MS, `${text} at ${roll}`);
    }
  }
  assert(thinkingTicks(long, 0) > thinkingTicks(short, 0));
  assert(thinkingTicks(short, 0.9) > thinkingTicks(short, 0));
});

Deno.test("the thinking delay does not choose the reply text", () => {
  // The first roll picks the reply and the second sets the thinking time.
  const timed = (second: number) => {
    const rolls = [0.5, second];
    let at = 0;
    const { conversations, run, heard } = setup(() => rolls[at++] ?? 0);
    conversations.ask("ada", "npc-ulgar", BUYS);
    const log = run(600);
    return {
      text: heard[0].text,
      thinking: log.filter((entry) => entry.typing).length,
    };
  };
  const quick = timed(0);
  const slow = timed(0.99);
  assertEquals(quick.text, slow.text);
  assert(slow.thinking > quick.thinking);
});

Deno.test("a talk action runs through the simulation, and the host picks the reply", () => {
  const sim = createSimulation(roomRecipe(), { random: () => 0 });
  const ulgar = sim.world.players["npc-ulgar"];
  const joined = sim.join("ada");
  joined.x = ulgar.x;
  joined.y = ulgar.y + 1;
  joined.z = ulgar.z;
  joined.name = "Ada";
  const results: Record<string, unknown>[] = [];
  const talk = (choice: string, npc = "npc-ulgar") =>
    sim.enqueue("ada", { type: "talk", npc, choice }, (r) => results.push(r));
  talk("buys");
  talk("buys");
  talk("buys", "ada");
  sim.advanceTicks(1);
  assertEquals(results.map((result) => result.ok), [true, false, false]);
  const heard: string[] = [];
  for (let i = 0; i < 400; i++) {
    sim.advanceTicks(1);
    for (const bubble of ulgar.messages ?? []) {
      if (!heard.includes(bubble.text)) heard.push(bubble.text);
    }
  }
  assertEquals(heard, [`Ada, ${BUY_REPLIES[0]}`]);
});
