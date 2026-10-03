import { assertEquals } from "@std/assert";
import { createApp } from "../../src/server/app.ts";
import { openBuilds } from "../../src/server/builds.ts";
import { createRelay } from "../../src/server/relay.ts";
import { hostKeyFor } from "../../src/server/session-routes.ts";
import {
  createLocalProvider,
  createXirsysProvider,
  type SignalingProvider,
} from "../../src/server/signaling.ts";
import {
  createMemoryStore,
  TELEMETRY_RETENTION_MS,
} from "../../src/server/store.ts";
import { createSweeper } from "../../src/server/sweep.ts";

const COMMIT = "a".repeat(40);
const DAY = 24 * 60 * 60_000;

/** A provider that records the channels it is asked to delete, and can be made to fail. */
function stubProvider() {
  const closed: string[] = [];
  const state = { fail: false };
  const provider: SignalingProvider = {
    open: () => Promise.resolve(null),
    iceServers: () => Promise.resolve([]),
    close(session) {
      if (state.fail) return Promise.reject(new Error("Xirsys is down"));
      closed.push(session);
      return Promise.resolve();
    },
  };
  return { provider, closed, state };
}

function fixture() {
  let time = 1_000_000;
  const store = createMemoryStore({ now: () => time });
  const stub = stubProvider();
  const start = (id: string) =>
    store.startSession({ id, buildCommit: COMMIT, hostPeer: "host" });
  return {
    store,
    ...stub,
    start,
    now: () => time,
    advance: (ms: number) => time += ms,
  };
}

Deno.test("the sweep deletes the channel of an ended session once", async () => {
  const f = fixture();
  const sweeper = createSweeper({
    store: f.store,
    provider: f.provider,
    now: f.now,
  });
  await f.start("session-live");
  await f.start("session-done");
  await f.store.endSession("session-done");
  assertEquals((await sweeper.run()).closed, ["session-done"]);
  assertEquals(f.closed, ["session-done"]);
  // Nothing is left to sweep, and the live session keeps its channel.
  assertEquals((await sweeper.run()).closed, []);
  assertEquals(f.closed, ["session-done"]);
});

Deno.test("the sweep also takes a session whose heartbeat timed out", async () => {
  const f = fixture();
  const sweeper = createSweeper({
    store: f.store,
    provider: f.provider,
    now: f.now,
  });
  await f.start("session-quiet");
  f.advance(44_000);
  assertEquals((await sweeper.run()).closed, []);
  f.advance(2_000);
  assertEquals((await sweeper.run()).closed, ["session-quiet"]);
});

Deno.test("several isolates sweeping at once delete a channel only once", async () => {
  const f = fixture();
  const isolates = [1, 2, 3].map(() =>
    createSweeper({ store: f.store, provider: f.provider, now: f.now })
  );
  for (const id of ["session-a1", "session-b2", "session-c3"]) {
    await f.start(id);
    await f.store.endSession(id);
  }
  const results = await Promise.all(isolates.map((sweeper) => sweeper.run()));
  assertEquals(f.closed.toSorted(), ["session-a1", "session-b2", "session-c3"]);
  assertEquals(results.flatMap((result) => result.closed).length, 3);
});

Deno.test("a failed delete is retried after the lease, not at once", async () => {
  const f = fixture();
  const sweeper = createSweeper({
    store: f.store,
    provider: f.provider,
    now: f.now,
    leaseMs: 120_000,
  });
  await f.start("session-fail");
  await f.store.endSession("session-fail");
  f.state.fail = true;
  assertEquals((await sweeper.run()).failed, ["session-fail"]);
  f.state.fail = false;
  // Another isolate still sees the lease.
  assertEquals((await sweeper.run()).closed, []);
  f.advance(120_000);
  assertEquals((await sweeper.run()).closed, ["session-fail"]);
  assertEquals(f.closed, ["session-fail"]);
});

Deno.test("maybeRun works at most once a minute and never throws", async () => {
  const f = fixture();
  const sweeper = createSweeper({
    store: f.store,
    provider: f.provider,
    now: f.now,
  });
  await f.start("session-one1");
  await f.store.endSession("session-one1");
  assertEquals((await sweeper.maybeRun())?.closed, ["session-one1"]);
  await f.start("session-two2");
  await f.store.endSession("session-two2");
  f.advance(59_000);
  assertEquals(await sweeper.maybeRun(), null);
  assertEquals(f.closed, ["session-one1"]);
  f.advance(1_000);
  assertEquals((await sweeper.maybeRun())?.closed, ["session-two2"]);
  // A store that fails does not fail the request that triggered the sweep.
  f.advance(60_000);
  const broken = createSweeper({
    store: {
      ...f.store,
      listSessionsToSweep: () => Promise.reject(new Error("database down")),
    },
    provider: f.provider,
    now: f.now,
  });
  const original = console.error;
  console.error = () => {};
  try {
    assertEquals(await broken.maybeRun(), null);
  } finally {
    console.error = original;
  }
});

Deno.test("the sweep deletes the session channel through Xirsys", async () => {
  const f = fixture();
  const calls: string[] = [];
  const xirsys = createXirsysProvider({
    ident: "id",
    secret: "secret",
    channel: "OpenDwarf",
    fetch: (_input, init) => {
      calls.push(`${init?.method} ${new URL(String(_input)).pathname}`);
      return Promise.resolve(Response.json({ s: "ok", v: "ok" }));
    },
  });
  await f.start("session-xirsys");
  await f.store.endSession("session-xirsys");
  await createSweeper({ store: f.store, provider: xirsys, now: f.now }).run();
  assertEquals(calls, ["DELETE /_ns/OpenDwarf/session-xirsys"]);
});

Deno.test("telemetry older than 30 days is pruned, and newer is kept", async () => {
  const f = fixture();
  const summary = {
    route: "host/host",
    role: "host" as const,
    players: 1,
    frameMeanMs: 8,
    frameMaxMs: 9,
    rttMs: null,
    bytes: 10,
    test: false,
  };
  const sweeper = createSweeper({
    store: f.store,
    provider: f.provider,
    now: f.now,
  });
  await f.store.recordTelemetry({ ...summary, session: "session-old1" });
  f.advance(10 * DAY);
  await f.store.recordTelemetry({ ...summary, session: "session-mid1" });
  f.advance(TELEMETRY_RETENTION_MS - 10 * DAY + 1);
  await f.store.recordTelemetry({ ...summary, session: "session-new1" });
  assertEquals((await sweeper.run()).pruned, 1);
  assertEquals(await f.store.listTelemetry("session-old1"), []);
  assertEquals((await f.store.listTelemetry("session-mid1")).length, 1);
  assertEquals((await f.store.listTelemetry("session-new1")).length, 1);
  f.advance(31 * DAY);
  assertEquals((await sweeper.run()).pruned, 2);
});

Deno.test("a session end and later starts and heartbeats sweep the shell's channels", async () => {
  let time = 1_000_000;
  const store = createMemoryStore({ now: () => time });
  const relay = createRelay();
  const app = createApp(openBuilds(store), undefined, {
    relay,
    provider: createLocalProvider(relay),
    secret: "test-secret",
    now: () => time,
  });
  const call = async (path: string, init?: RequestInit) => {
    const response = await app(
      new Request(`http://localhost${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
      }),
    );
    await response.body?.cancel();
    return response.status;
  };
  assertEquals(
    await call("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ id: "session-gone" }),
    }),
    200,
  );
  assertEquals(
    await call("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ id: "session-stays" }),
    }),
    200,
  );
  // The first host walks away: its heartbeats stop, the second keeps beating.
  const stays = await hostKeyFor("test-secret", "session-stays");
  // The sweep runs at most once a minute in one isolate.
  time += 61_000;
  assertEquals(relay.hasChannel("local/session-gone"), true);
  assertEquals(
    await call("/api/v1/sessions/session-stays/heartbeat", {
      method: "POST",
      headers: { "x-host-key": stays },
      body: JSON.stringify({ players: 1 }),
    }),
    200,
  );
  assertEquals(relay.hasChannel("local/session-gone"), false);
  assertEquals(relay.hasChannel("local/session-stays"), true);
});
