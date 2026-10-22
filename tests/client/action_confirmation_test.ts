import { assertEquals } from "@std/assert";
import { createActionConfirmer } from "../../src/client/action-confirmation.js";
import { addPlayer } from "../../src/shared/world.js";
import { addTrader } from "../shared/fixtures.ts";
import { createFixtureWorld } from "../../src/shared/world-builder.js";
import type { ActionResult } from "../../src/shared/action-wire.js";
import { hostMessages } from "../../src/client/host-messages.js";
import type { HostPeer } from "../../src/client/host-messages.js";
import { addStack, dropItem, inventoryOf } from "../../src/shared/items.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import { sellItems } from "../../src/shared/shop.js";
import { ensureChunk, OPEN, STONE } from "../../src/shared/terrain.js";

Deno.test("only accepted pickup/place/sell actions confirm, using the action or seller tile", () => {
  const world = createFixtureWorld();
  const player = addPlayer(world, "guest", { x: 3.2, y: 4.8, z: 1 });
  const sent: ActionResult[] = [];
  const confirm = createActionConfirmer({
    attempt: () => "current",
    player: () => player,
    reply: (packet) => sent.push(packet),
  });
  for (const action of ["pickup", "place", "sell"]) {
    const message = { type: action, x: 6, y: 7, z: 2 };
    confirm(message, { ok: false, reason: "refused" });
    confirm(message, { ok: "true" });
    confirm(message, { ok: true });
  }
  assertEquals(sent, [
    {
      type: "action-result",
      attempt: "current",
      action: "pickup",
      x: 6,
      y: 7,
      z: 2,
    },
    {
      type: "action-result",
      attempt: "current",
      action: "place",
      x: 6,
      y: 7,
      z: 2,
    },
    {
      type: "action-result",
      attempt: "current",
      action: "sell",
      x: 3,
      y: 5,
      z: 1,
    },
  ]);
  confirm({ type: "mine", x: 6, y: 7, z: 2 }, { ok: true });
  assertEquals(sent.length, 3);
});

Deno.test("a pending simulation result cannot confirm to a replacement connection", () => {
  const world = createFixtureWorld();
  let player = addPlayer(world, "guest", { x: 3, y: 5, z: 1 }) as
    | ReturnType<typeof addPlayer>
    | undefined;
  let attempt = "old";
  const sent: ActionResult[] = [];
  const confirm = createActionConfirmer({
    attempt: () => attempt,
    player: () => player,
    reply: (packet) => sent.push(packet),
  });
  const requestAttempt = attempt;
  const message = { type: "pickup", x: 4, y: 5, z: 1 };
  const pendingResult = () => confirm(message, { ok: true }, requestAttempt);
  attempt = "new";
  pendingResult();
  assertEquals(sent, []);
  confirm(message, { ok: true }, attempt);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].attempt, "new");
  player = undefined;
  confirm(message, { ok: true });
  assertEquals(sent.length, 1);
});

Deno.test("fallback host handlers confirm each accepted action once and report refusals silently", () => {
  const world = createFixtureWorld();
  const data = ensureChunk(world, 0, 0);
  data.fill(OPEN);
  data.fill(STONE, 0, 256);
  addTrader(world, { x: 4, y: 5, z: 1 });
  const player = addPlayer(world, "guest", { x: 5, y: 5, z: 1 });
  addStack(inventoryOf(player), "stone", 2);
  setHeldItem(world, "guest", "stone");
  const replies: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const reply = (message: Record<string, unknown>) => replies.push(message);
  const peer = {
    scene: { world },
    playerId: "guest",
    sees: () => () => true,
    tell: (_id: string, text: string) => lines.push(text),
    sellAt: (id: string, request: unknown) => sellItems(world, id, request),
    reply,
    confirmAction: createActionConfirmer({
      attempt: () => "current",
      player: () => player,
      reply,
    }),
  } as unknown as HostPeer;
  const place = { type: "place", x: 6, y: 5, z: 1 };
  const pickup = { type: "pickup", x: 5, y: 6, z: 1, kind: "coal" };
  const sell = { type: "sell", kind: "coal", count: 1 };
  dropItem(world, pickup, "coal", 1);
  for (const message of [place, pickup, sell]) {
    const handler = hostMessages.get(message.type)!;
    handler(peer, message);
    handler(peer, message);
  }
  assertEquals(
    replies.filter((packet) => packet.type === "action-result").map((packet) =>
      packet.action
    ),
    ["place", "pickup", "sell"],
  );
  assertEquals(
    replies.filter((packet) => packet.type !== "action-result").map((packet) =>
      packet.type
    ),
    ["place-result", "pickup-result", "sell-result"],
  );
  assertEquals(lines.length, 2);
});

Deno.test("a spoken sale confirms as a sale only when the host accepted it", () => {
  const world = createFixtureWorld();
  const player = addPlayer(world, "guest", { x: 3.2, y: 4.8, z: 1 });
  const sent: ActionResult[] = [];
  const confirm = createActionConfirmer({
    attempt: () => "current",
    player: () => player,
    reply: (packet) => sent.push(packet),
  });
  const message = { type: "talk", npc: "npc-ulgar", choice: "sale" };
  // A refused request, a refused outcome (nothing to sell), and a spoken
  // question carry no sale line, so none confirms.
  confirm(message, { ok: false, reason: "too far to talk" });
  confirm(message, { ok: true });
  confirm({ ...message, choice: "buys" }, { ok: true });
  assertEquals(sent, []);
  confirm(message, { ok: true, line: "Sold coal ×3 for 3 coins" });
  assertEquals(sent, [{
    type: "action-result",
    attempt: "current",
    action: "sell",
    x: 3,
    y: 5,
    z: 1,
  }]);
});
