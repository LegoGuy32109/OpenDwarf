import { assert, assertEquals } from "@std/assert";
import { createRateLimiter } from "../../src/server/rate-limit.ts";
import { createApp } from "../../src/server/app.ts";
import { hostKeyFor } from "../../src/server/session-routes.ts";
import { createRelay } from "../../src/server/relay.ts";
import { createMemoryStore } from "../../src/server/store.ts";
import { openBuilds } from "../../src/server/builds.ts";
import {
  createLocalProvider,
  createXirsysProvider,
  iceList,
} from "../../src/server/signaling.ts";

Deno.test("the rate limiter allows a limit per key in each window", () => {
  let time = 0;
  const limiter = createRateLimiter({
    limit: 2,
    windowMs: 1000,
    now: () => time,
  });
  assertEquals([limiter.allow("a"), limiter.allow("a"), limiter.allow("a")], [
    true,
    true,
    false,
  ]);
  assertEquals(limiter.allow("b"), true);
  time = 1000;
  assertEquals(limiter.allow("a"), true);
});

const COMMIT = "a".repeat(40);
const OTHER = "b".repeat(40);

/** A shell with the in-memory store, the local relay, and a clock the test moves. */
function shell(options = {}) {
  let time = 1_000_000;
  const store = createMemoryStore({ now: () => time });
  const relay = createRelay();
  const app = createApp(openBuilds(store), undefined, {
    relay,
    provider: createLocalProvider(relay),
    secret: "test-secret",
    now: () => time,
    ...options,
  });
  const call = (path: string, init?: RequestInit, ip = "1.1.1.1") =>
    app(
      new Request(`http://localhost${path}`, {
        ...init,
        headers: { "x-forwarded-for": ip, ...init?.headers },
      }),
    );
  return { store, relay, call, advance: (ms: number) => time += ms };
}

const json = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

/** Starts a session on a build and returns its host key. */
async function start(
  s: ReturnType<typeof shell>,
  id: string,
  build: { commit?: string; label?: string } = {},
) {
  const response = await s.call("/api/v1/sessions", json({ id, ...build }));
  assertEquals(response.status, 200);
  return (await response.json()).hostKey as string;
}

const beat = (
  s: ReturnType<typeof shell>,
  id: string,
  key: string,
  body: Record<string, unknown> = { players: 1 },
) =>
  s.call(`/api/v1/sessions/${id}/heartbeat`, {
    ...json(body),
    headers: { "content-type": "application/json", "x-host-key": key },
  });

Deno.test("a host starts a session and a guest joins it", async () => {
  const s = shell();
  const guestId = `peer-${crypto.randomUUID()}`;
  const start = await s.call(
    "/api/v1/sessions",
    json({ id: "session-one", commit: COMMIT, label: "demo" }),
  );
  assertEquals(start.status, 200);
  const host = await start.json();
  assertEquals(host.peer, "host");
  assert(host.hostKey.length > 20);
  assert(host.signalUrl.endsWith(`/v2/${host.token}`));
  const join = await s.call(
    "/api/v1/sessions/session-one/join",
    json({ peer: guestId }),
  );
  const guest = await join.json();
  assertEquals(guest.channel, host.channel);
  assert(guest.token !== host.token);
  assertEquals(guest.hostKey, undefined);
  // The join response names the host's build, so a guest on another build can go there.
  assertEquals(guest.build, {
    commit: COMMIT,
    label: "demo",
    path: `/b/${COMMIT}/`,
  });
  const ice = await s.call("/api/v1/sessions/session-one/ice");
  assertEquals(await ice.json(), { iceServers: [] });
  const stored = await s.store.getSession("session-one");
  assertEquals(
    [stored?.buildCommit, stored?.label, stored?.playerCount, stored?.ended],
    [COMMIT, "demo", 1, null],
  );
});

Deno.test("a session without a build is recorded as the local build", async () => {
  const s = shell();
  await start(s, "session-local");
  const join = await s.call(
    "/api/v1/sessions/session-local/join",
    json({ peer: `peer-${crypto.randomUUID()}` }),
  );
  assertEquals((await join.json()).build, {
    commit: "local",
    label: null,
    path: "/b/local/",
  });
  for (const bad of [{ commit: "not-a-commit" }, { label: "bad/label" }]) {
    const response = await s.call(
      "/api/v1/sessions",
      json({ id: "session-badbuild", ...bad }),
    );
    assertEquals(response.status, 400);
    await response.body?.cancel();
  }
});

Deno.test("a join needs a real session and a guest peer name", async () => {
  const s = shell();
  const guestId = `peer-${crypto.randomUUID()}`;
  const missing = await s.call(
    "/api/v1/sessions/nobody-home/join",
    json({ peer: guestId }),
  );
  assertEquals(missing.status, 404);
  await (await s.call("/api/v1/sessions", json({ id: "session-two" }))).body
    ?.cancel();
  for (const peer of ["host", "x", 5]) {
    const response = await s.call(
      "/api/v1/sessions/session-two/join",
      json({ peer }),
    );
    assertEquals(response.status, 400);
    await response.body?.cancel();
  }
  await missing.body?.cancel();
});

Deno.test("only the host's key ends a session or renews its token", async () => {
  const s = shell();
  const host =
    await (await s.call("/api/v1/sessions", json({ id: "session-key" })))
      .json();
  const denied = await s.call("/api/v1/sessions/session-key", {
    method: "DELETE",
    headers: { "x-host-key": "wrong" },
  });
  assertEquals(denied.status, 403);
  await denied.body?.cancel();
  const renewed = await (await s.call(
    "/api/v1/sessions",
    json({ id: "session-key", hostKey: host.hostKey }),
  )).json();
  assert(renewed.token !== host.token);
  assertEquals(s.relay.hasChannel("local/session-key"), true);
  const ended = await s.call("/api/v1/sessions/session-key", {
    method: "DELETE",
    headers: { "x-host-key": host.hostKey },
  });
  assertEquals(ended.status, 200);
  await ended.body?.cancel();
  assertEquals(s.relay.hasChannel("local/session-key"), false);
  // The session stays as history, ended, and takes no more guests.
  assertEquals(
    typeof (await s.store.getSession("session-key"))?.ended,
    "number",
  );
  const late = await s.call(
    "/api/v1/sessions/session-key/join",
    json({ peer: `peer-${crypto.randomUUID()}` }),
  );
  assertEquals(late.status, 404);
  await late.body?.cancel();
});

Deno.test("a session id that is taken cannot be started again without its key", async () => {
  const s = shell();
  const key = await start(s, "session-taken");
  const taken = await s.call("/api/v1/sessions", json({ id: "session-taken" }));
  assertEquals(taken.status, 409);
  await taken.body?.cancel();
  const renewed = await s.call(
    "/api/v1/sessions",
    json({ id: "session-taken", hostKey: key }),
  );
  assertEquals(renewed.status, 200);
  await renewed.body?.cancel();
});

Deno.test("session starts and joins are limited per IP", async () => {
  const s = shell({
    startLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
  });
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    const response = await s.call(
      "/api/v1/sessions",
      json({ id: `session-${i}-x-aa` }),
    );
    statuses.push(response.status);
    await response.body?.cancel();
  }
  assertEquals(statuses, [200, 200, 429]);
  const other = await s.call(
    "/api/v1/sessions",
    json({ id: "session-other-ip" }),
    "2.2.2.2",
  );
  assertEquals(other.status, 200);
  await other.body?.cancel();
});

Deno.test("the old signal, ICE, and presence routes are gone", async () => {
  const s = shell();
  for (const path of ["/api/signal/abcdefgh/host", "/api/v1/ice"]) {
    const response = await s.call(path);
    assertEquals(response.status, 404);
    await response.body?.cancel();
  }
  const presence = await s.call(
    "/api/v1/presence",
    json({ id: "session-old" }),
  );
  assertEquals(presence.status, 405);
  await presence.body?.cancel();
  const listing = await s.call("/api/v1/admin/sessions");
  assertEquals(listing.status, 404);
  await listing.body?.cancel();
});

Deno.test("a heartbeat from the host keeps the session live and updates its player count", async () => {
  const s = shell();
  const key = await start(s, "session-beat", { commit: COMMIT });
  s.advance(15_000);
  const ok = await beat(s, "session-beat", key, {
    players: 4,
    commit: COMMIT,
    label: "demo",
  });
  assertEquals(ok.status, 200);
  await ok.body?.cancel();
  const stored = await s.store.getSession("session-beat");
  assertEquals([stored?.playerCount, stored?.lastHeartbeat], [4, 1_015_000]);
  // 40 s after that heartbeat, and 55 s after the start: still live.
  s.advance(40_000);
  const live = await (await s.call("/api/v1/sessions")).json();
  assertEquals(live.sessions.map((x: { id: string }) => x.id), [
    "session-beat",
  ]);
  assertEquals(live.sessions[0].playerCount, 4);
});

Deno.test("only the host's key sends a heartbeat", async () => {
  const s = shell();
  await start(s, "session-auth");
  for (const key of ["", "wrong", "a".repeat(64)]) {
    const response = await beat(s, "session-auth", key, { players: 9 });
    assertEquals(response.status, 403);
    await response.body?.cancel();
  }
  // Another session's key does not open this one.
  const other = await start(s, "session-other");
  const crossed = await beat(s, "session-auth", other, { players: 9 });
  assertEquals(crossed.status, 403);
  await crossed.body?.cancel();
  assertEquals((await s.store.getSession("session-auth"))?.playerCount, 1);
});

Deno.test("a heartbeat needs a player count and a valid build", async () => {
  const s = shell();
  const key = await start(s, "session-input");
  const bodies: Record<string, unknown>[] = [
    {},
    { players: -1 },
    { players: 1.5 },
    { players: "3" },
    { players: 99_999 },
    { players: 1, commit: "nope" },
    { players: 1, label: "a b" },
  ];
  for (const body of bodies) {
    const response = await beat(s, "session-input", key, body);
    assertEquals(response.status, 400, JSON.stringify(body));
    await response.body?.cancel();
  }
});

Deno.test("a session with no heartbeat for 45 seconds counts as ended and stays as history", async () => {
  const s = shell();
  const key = await start(s, "session-quiet", { commit: COMMIT });
  const busyKey = await start(s, "session-busy", { commit: OTHER });
  s.advance(30_000);
  const kept = await beat(s, "session-busy", busyKey, { players: 2 });
  await kept.body?.cancel();
  s.advance(15_001);
  const live = await (await s.call("/api/v1/sessions")).json();
  assertEquals(
    live.sessions.map((x: { id: string }) => x.id),
    ["session-busy"],
  );
  const recent = await (await s.call("/api/v1/sessions/recent")).json();
  const quiet = recent.sessions.find((x: { id: string }) =>
    x.id === "session-quiet"
  );
  assertEquals(quiet.ended, 1_000_000 + 45_000);
  assertEquals(quiet.build.commit, COMMIT);
  // It is history, not deleted: still in the store, and it can beat again until it is marked ended.
  assertEquals((await s.store.getSession("session-quiet"))?.ended, null);
  const back = await beat(s, "session-quiet", key, { players: 1 });
  assertEquals(back.status, 200);
  await back.body?.cancel();
});

Deno.test("a heartbeat to an ended session is refused, and one for an unrecorded session records it", async () => {
  const s = shell();
  const key = await start(s, "session-done");
  const ended = await s.call("/api/v1/sessions/session-done", {
    method: "DELETE",
    headers: { "x-host-key": key },
  });
  await ended.body?.cancel();
  const late = await beat(s, "session-done", key, { players: 1 });
  assertEquals(late.status, 410);
  await late.body?.cancel();
  // A host key is valid for any id the shell signs, so a heartbeat can make the record.
  const lost = await hostKeyFor("test-secret", "session-lost");
  const made = await beat(s, "session-lost", lost, {
    players: 3,
    commit: OTHER,
    label: "x",
  });
  assertEquals(made.status, 200);
  await made.body?.cancel();
  const stored = await s.store.getSession("session-lost");
  assertEquals(
    [stored?.buildCommit, stored?.label, stored?.playerCount],
    [OTHER, "x", 3],
  );
});

Deno.test("public session reads carry no host key or peer id", async () => {
  const s = shell();
  const key = await start(s, "session-public", { commit: COMMIT });
  await start(s, "session-gone", { commit: COMMIT });
  const ended = await s.call("/api/v1/sessions/session-gone", {
    method: "DELETE",
    headers: { "x-host-key": await hostKeyFor("test-secret", "session-gone") },
  });
  await ended.body?.cancel();
  await s.call(
    "/api/v1/telemetry",
    json({
      kind: "summary",
      session: "session-public",
      participant: `peer-${crypto.randomUUID()}`,
      role: "host",
      route: "host/host",
      players: 2,
    }),
  ).then((r) => r.body?.cancel());
  for (
    const path of [
      "/api/v1/sessions",
      "/api/v1/sessions/recent",
      "/api/v1/sessions/session-public/telemetry",
    ]
  ) {
    const response = await s.call(path);
    assertEquals(response.status, 200, path);
    const text = await response.text();
    assertEquals(text.includes(key), false, path);
    for (const word of ["hostKey", "hostPeer", "peer-", "participant"]) {
      assertEquals(text.includes(word), false, `${path} shows ${word}`);
    }
  }
  const recent = await (await s.call("/api/v1/sessions/recent")).json();
  assertEquals(
    recent.sessions.map((x: { id: string }) => x.id),
    ["session-gone"],
  );
});

Deno.test("a session's telemetry lists its stored summaries", async () => {
  const s = shell();
  await start(s, "session-stats");
  for (const rttMs of [40, 50]) {
    const response = await s.call(
      "/api/v1/telemetry",
      json({
        kind: "summary",
        session: "session-stats",
        role: "guest",
        route: "host/srflx",
        rttMs,
      }),
    );
    assertEquals(response.status, 200);
    await response.body?.cancel();
    s.advance(10_000);
  }
  const body = await (await s.call("/api/v1/sessions/session-stats/telemetry"))
    .json();
  assertEquals(body.telemetry.map((row: { rttMs: number }) => row.rttMs), [
    40,
    50,
  ]);
  assertEquals(body.telemetry[0].route, "host/srflx");
  const missing = await s.call("/api/v1/sessions/session-nope1/telemetry");
  assertEquals(missing.status, 404);
  await missing.body?.cancel();
});

Deno.test("the Xirsys provider creates the sub-channel, then asks for a token, host, and ICE servers", async () => {
  const calls: string[] = [];
  const provider = createXirsysProvider({
    ident: "id",
    secret: "secret",
    channel: "OpenDwarf",
    fetch: (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method} ${url.pathname}${url.search}`);
      assertEquals(
        (init?.headers as Record<string, string>).authorization,
        `Basic ${btoa("id:secret")}`,
      );
      const v = url.pathname.startsWith("/_token")
        ? "tok"
        : url.pathname.startsWith("/_host")
        ? "wss://us-api2.xirsys.com:443/ws"
        : url.pathname.startsWith("/_turn")
        ? { iceServers: { urls: ["turn:x"], username: "u", credential: "c" } }
        : "ok";
      return Promise.resolve(Response.json({ s: "ok", v }));
    },
  });
  const result = await provider.open("abc12345", "host", {
    create: true,
    origin: "http://x",
  });
  assertEquals(calls[0], "PUT /_ns/OpenDwarf/abc12345");
  assertEquals(
    calls.slice(1).sort(),
    [
      "GET /_host/OpenDwarf/abc12345?type=signal&k=host",
      "PUT /_token/OpenDwarf/abc12345?k=host&expire=60",
      "PUT /_turn/OpenDwarf/abc12345?webrtc=1&expire=60",
    ],
  );
  assertEquals(result?.channel, "OpenDwarf/abc12345");
  assertEquals(result?.signalUrl, "wss://us-api2.xirsys.com:443/ws/v2/tok");
  assertEquals(result?.iceServers.length, 1);
  await provider.close("abc12345");
  assertEquals(calls.at(-1), "DELETE /_ns/OpenDwarf/abc12345");
});

Deno.test("iceList wraps one server and passes a list through", () => {
  assertEquals(iceList({ iceServers: { urls: "a" } }), [{ urls: "a" }]);
  assertEquals(iceList({ iceServers: [{ urls: "a" }] }), [{ urls: "a" }]);
  assertEquals(iceList(null), []);
});
