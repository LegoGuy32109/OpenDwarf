import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { ready } from "./ui.ts";
test("unordered motion waits for sight, rejects old attempts, and survives older state", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1");
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    readWorld(guest, (__world) => Boolean(__world.wireDebug()?.state))
  ).toBeTruthy();
  const result = await readWorld(guest, (__world) => {
    const game = __world;
    const debug = game.wireDebug()!;
    const base = structuredClone(debug.state!);
    base.world.tick += 10000;
    base.viewRevision += 10;
    base.mode = "master";
    base.visibility = null;
    // Open air for the whole chunk: eight runs of 256 tiles.
    base.reveal = {
      "0,0": btoa(String.fromCharCode(...Array(8).fill([1, 255]).flat())),
    };
    const own = base.world.players[base.playerId];
    const probe = { ...own, id: "packet-probe", name: "probe", x: 7, y: 6 };
    base.world.players[probe.id] = probe;
    game.injectPacket(base);
    const stamp = {
      attempt: base.attempt,
      viewRevision: base.viewRevision,
      sightRevision: base.sightRevision,
    };
    const motion = {
      type: "motion",
      ...stamp,
      tick: base.world.tick + 1,
      players: { ...base.world.players, [probe.id]: { ...probe, x: 7.1 } },
      acknowledgedSequence: 0,
    };
    game.injectPacket(motion, true);
    game.injectPacket(base);
    const preserved = game.scene.world.players[probe.id].x;
    const future = {
      ...motion,
      sightRevision: stamp.sightRevision + 1,
      tick: base.world.tick + 3,
      players: { ...motion.players, [probe.id]: { ...probe, x: 7.3 } },
    };
    game.injectPacket(future, true);
    game.injectPacket({ ...future, tick: base.world.tick + 2 }, true);
    const waiting = game.scene.world.players[probe.id].x;
    const pendingTick = game.wireDebug()!.pending?.tick;
    game.injectPacket({
      ...base,
      sightRevision: future.sightRevision,
      world: { ...base.world, tick: base.world.tick + 2 },
    });
    const applied = game.scene.world.players[probe.id].x;
    game.injectPacket({
      ...future,
      attempt: "replaced-attempt",
      tick: future.tick + 1,
    }, true);
    const oldAttempt = game.scene.world.players[probe.id].x;
    const beforeTerrain = game.scene.world.chunks.get("0,0")?.[0];
    const invalid = structuredClone(base);
    invalid.world.tick += 20;
    invalid.reveal["0,0"] = "AAAA";
    game.injectPacket(invalid);
    const afterTerrain = game.scene.world.chunks.get("0,0")?.[0];
    game.injectPacket({
      ...base,
      viewRevision: stamp.viewRevision + 1,
      sightRevision: 0,
      world: {
        ...base.world,
        tick: future.tick + 1,
        players: { [base.playerId]: own },
      },
    });
    game.injectPacket({ ...future, tick: future.tick + 100 }, true);
    return {
      ordered: debug.ordered,
      maxRetransmits: debug.maxRetransmits,
      channels: [debug.reliable, debug.motionChannel],
      preserved,
      waiting,
      pendingTick,
      expectedPendingTick: future.tick,
      applied,
      oldAttempt,
      beforeTerrain,
      afterTerrain,
      hiddenStayedHidden: !game.scene.world.players[probe.id],
    };
  });
  expect(result.ordered).toBe(false);
  expect(result.maxRetransmits).toBe(0);
  expect(result.channels).toEqual(["open", "open"]);
  expect(result.preserved).toBe(7.1);
  expect(result.waiting).toBe(7.1);
  expect(result.pendingTick).toBe(result.expectedPendingTick);
  expect(result.applied).toBe(7.3);
  expect(result.oldAttempt).toBe(7.3);
  expect(result.beforeTerrain).toBe(1);
  expect(result.afterTerrain).toBe(result.beforeTerrain);
  expect(result.hiddenStayedHidden).toBe(true);
  await host.close();
  await guest.close();
});
test("an incompatible join ends with a refresh instruction", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1");
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await guest.routeWebSocket(/\/v2\//, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.p?.kind === "join") {
        frame.p.data.version = 1;
      }
      server.send(JSON.stringify(frame));
    });
    server.onMessage((message) => socket.send(message));
  });
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    readWorld(
      guest,
      (__world) => __world.scene.status.includes("Refresh both pages"),
    )
  ).toBeTruthy();
  expect(await readWorld(guest, (__world) => __world.scene.status)).toContain(
    "Different game versions",
  );
  await host.close();
  await guest.close();
});
test("reliable chat survives simulated motion loss and jitter", {
  tag: "@smoke",
}, async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await openWorld(host, "/?harness=1&loss=0.2&delay=50&jitter=60");
  await ready(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(
    guest,
    `/join/${session}?harness=1&loss=0.2&delay=50&jitter=60`,
  );
  await ready(guest);
  await expect.poll(() =>
    readWorld(guest, (__world) => Boolean(__world.wireDebug()?.state))
  ).toBeTruthy();
  await readWorld(guest, (__world) => __world.openChat());
  await guest.keyboard.type("reliable chat");
  await guest.keyboard.press("Enter");
  await expect.poll(() =>
    readWorld(
      guest,
      (__world) =>
        __world.scene.chatFeed.some((record) =>
          record.text === "reliable chat"
        ),
    )
  ).toBeTruthy();
  await host.close();
  await guest.close();
});
