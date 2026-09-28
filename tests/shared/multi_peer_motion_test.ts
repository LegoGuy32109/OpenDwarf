import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { assert, assertEquals } from "@std/assert";
import { createPresentation } from "../../src/client/presentation.js";
import { createCornerNpc } from "../../src/shared/npc.js";
import { mergeSnapshot } from "../../src/shared/reconcile.js";
import { addPlayer, advanceTicks, startMove } from "../../src/shared/world.js";

Deno.test("three peers present continuous movement through delayed and reordered snapshots", () => {
  const host = createAuthoredWorld();
  addPlayer(host, "self", { x: 7, y: 7, z: 0 });
  addPlayer(host, "peer-a", { x: 8, y: 7, z: 0 });
  addPlayer(host, "peer-b", { x: 9, y: 7, z: 0 });
  const tickNpc = createCornerNpc(host);
  const clients = {
    "peer-a": structuredClone(host),
    "peer-b": structuredClone(host),
  };
  const views = {
    host: createPresentation(),
    "peer-a": createPresentation(),
    "peer-b": createPresentation(),
  };
  type PeerId = keyof typeof clients;
  type ViewerId = keyof typeof views;
  type Packet = { at: number; sourceTick: number; world: typeof host };
  const packets: Record<PeerId, Packet[]> = {
    "peer-a": [],
    "peer-b": [],
  };
  const lastSnapshot: Record<PeerId, number> = {
    "peer-a": -1,
    "peer-b": -1,
  };
  const watched: Record<ViewerId, string[]> = {
    host: ["peer-a", "peer-b", "npc-corner"],
    "peer-a": ["self", "peer-b", "npc-corner"],
    "peer-b": ["self", "peer-a", "npc-corner"],
  };
  const traces: Record<string, { x: number; y: number }[]> = {};
  for (const [viewer, ids] of Object.entries(watched)) {
    for (const id of ids) traces[`${viewer}:${id}`] = [];
  }

  for (let tick = 0; tick <= 42; tick++) {
    if (tick) {
      advanceTicks(host);
      for (const client of Object.values(clients)) advanceTicks(client);
    }
    if (tick % 10 === 0 && tick <= 30) {
      assert(startMove(host, "self", -1, 0, tick / 10 + 1).ok);
      assert(startMove(host, "peer-a", 0, -1, tick / 10 + 1).ok);
      assert(startMove(host, "peer-b", 1, 0, tick / 10 + 1).ok);
    }
    tickNpc();
    if (tick % 2 === 0) {
      const snapshot = structuredClone(host);
      const delay = [4, 1, 3, 1][(tick / 2) % 4];
      for (const id of Object.keys(clients) as PeerId[]) {
        packets[id].push({
          at: tick + delay,
          sourceTick: tick,
          world: snapshot,
        });
      }
    }
    for (const id of Object.keys(clients) as PeerId[]) {
      for (const packet of packets[id].filter((item) => item.at === tick)) {
        if (packet.sourceTick <= lastSnapshot[id]) continue;
        mergeSnapshot(clients[id], packet.world, 0, 0, id);
        lastSnapshot[id] = packet.sourceTick;
      }
    }
    const worlds = { host, ...clients };
    for (const viewer of Object.keys(watched) as ViewerId[]) {
      for (const id of watched[viewer]) {
        const player = worlds[viewer].players[id];
        const displayed = views[viewer].positionAt(
          player,
          worlds[viewer].tick,
          false,
        );
        traces[`${viewer}:${id}`].push(displayed);
      }
    }
  }

  for (const [label, positions] of Object.entries(traces)) {
    let travel = 0;
    for (let i = 1; i < positions.length; i++) {
      const previous = positions[i - 1];
      const current = positions[i];
      const step = Math.hypot(
        current.x - previous.x,
        current.y - previous.y,
      );
      assert(step <= 0.126, `${label} jumped ${step} tiles at tick ${i}`);
      travel += step;
    }
    assert(travel > 2, `${label} moved only ${travel} tiles`);
  }
  assertEquals(host.tick, 42);
});
