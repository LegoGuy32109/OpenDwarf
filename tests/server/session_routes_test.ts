import { assert, assertEquals } from "@std/assert";
import { createRateLimiter } from "../../src/server/rate-limit.ts";
import { createApp } from "../../src/server/app.ts";
import { createRelay } from "../../src/server/relay.ts";
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

async function shell(options = {}) {
  const kv = await Deno.openKv(":memory:");
  const relay = createRelay();
  const app = createApp(kv, undefined, undefined, {
    relay,
    provider: createLocalProvider(relay),
    secret: "test-secret",
    ...options,
  });
  const call = (path: string, init?: RequestInit, ip = "1.1.1.1") =>
    app(
      new Request(`http://localhost${path}`, {
        ...init,
        headers: { "x-forwarded-for": ip, ...init?.headers },
      }),
    );
  return { kv, relay, call };
}

const json = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

Deno.test("a host starts a session and a guest joins it", async () => {
  const { kv, call } = await shell();
  const guestId = `peer-${crypto.randomUUID()}`;
  const start = await call("/api/v1/sessions", json({ id: "session-one" }));
  assertEquals(start.status, 200);
  const host = await start.json();
  assertEquals(host.peer, "host");
  assert(host.hostKey.length > 20);
  assert(host.signalUrl.endsWith(`/v2/${host.token}`));
  const join = await call(
    "/api/v1/sessions/session-one/join",
    json({ peer: guestId }),
  );
  const guest = await join.json();
  assertEquals(guest.channel, host.channel);
  assert(guest.token !== host.token);
  assertEquals(guest.hostKey, undefined);
  const ice = await call("/api/v1/sessions/session-one/ice");
  assertEquals(await ice.json(), { iceServers: [] });
  kv.close();
});

Deno.test("a join needs a real session and a guest peer name", async () => {
  const { kv, call } = await shell();
  const guestId = `peer-${crypto.randomUUID()}`;
  const missing = await call(
    "/api/v1/sessions/nobody-home/join",
    json({ peer: guestId }),
  );
  assertEquals(missing.status, 404);
  await (await call("/api/v1/sessions", json({ id: "session-two" }))).body
    ?.cancel();
  for (const peer of ["host", "x", 5]) {
    const response = await call(
      "/api/v1/sessions/session-two/join",
      json({ peer }),
    );
    assertEquals(response.status, 400);
    await response.body?.cancel();
  }
  await missing.body?.cancel();
  kv.close();
});

Deno.test("only the host's key ends a session or renews its token", async () => {
  const { kv, relay, call } = await shell();
  const host =
    await (await call("/api/v1/sessions", json({ id: "session-key" })))
      .json();
  const denied = await call("/api/v1/sessions/session-key", {
    method: "DELETE",
    headers: { "x-host-key": "wrong" },
  });
  assertEquals(denied.status, 403);
  await denied.body?.cancel();
  const renewed = await (await call(
    "/api/v1/sessions",
    json({ id: "session-key", hostKey: host.hostKey }),
  )).json();
  assert(renewed.token !== host.token);
  assertEquals(relay.hasChannel("local/session-key"), true);
  const ended = await call("/api/v1/sessions/session-key", {
    method: "DELETE",
    headers: { "x-host-key": host.hostKey },
  });
  assertEquals(ended.status, 200);
  await ended.body?.cancel();
  assertEquals(relay.hasChannel("local/session-key"), false);
  kv.close();
});

Deno.test("session starts and joins are limited per IP", async () => {
  const { kv, call } = await shell({
    startLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
  });
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    const response = await call(
      "/api/v1/sessions",
      json({ id: `session-${i}-x-aa` }),
    );
    statuses.push(response.status);
    await response.body?.cancel();
  }
  assertEquals(statuses, [200, 200, 429]);
  const other = await call(
    "/api/v1/sessions",
    json({ id: "session-other-ip" }),
    "2.2.2.2",
  );
  assertEquals(other.status, 200);
  await other.body?.cancel();
  kv.close();
});

Deno.test("the old signal and ICE routes are gone", async () => {
  const { kv, call } = await shell();
  for (const path of ["/api/signal/abcdefgh/host", "/api/v1/ice"]) {
    const response = await call(path);
    assertEquals(response.status, 404);
    await response.body?.cancel();
  }
  kv.close();
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
