import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp, joinLink } from "../../src/server/app.ts";
import { openBuilds } from "../../src/server/builds.ts";
import { createMemoryStore } from "../../src/server/store.ts";

function shell() {
  const store = createMemoryStore();
  return { store, app: createApp(openBuilds(store)) };
}

const post = (body: unknown) =>
  new Request("http://localhost/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

Deno.test("telemetry logs only approved fields and stores a summary", async () => {
  const { store, app } = shell();
  const logged: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => logged.push(values.join(" "));
  try {
    const response = await app(post({
      kind: "summary",
      session: "test-session",
      participant: `peer-${crypto.randomUUID()}`,
      role: "guest",
      route: "relay/relay",
      players: 3,
      frameMeanMs: 8.123,
      frameMaxMs: 40,
      rttMs: 103.43,
      bytesSent: 2048.4,
      draft: "private draft",
      message: "private message",
    }));
    assertEquals(response.status, 200);
    assertEquals(logged.length, 1);
    assertStringIncludes(logged[0], '"rttMs":103.43');
    assertEquals(logged[0].includes("private"), false);
  } finally {
    console.log = original;
  }
  const [row] = await store.listTelemetry("test-session");
  assertEquals(row.route, "relay/relay");
  assertEquals(
    [row.role, row.players, row.frameMeanMs, row.rttMs, row.bytes, row.test],
    ["guest", 3, 8.12, 103.43, 2048, false],
  );
  // Nothing from a draft, a message, or a peer id reaches the store.
  assertEquals(JSON.stringify(row).includes("private"), false);
  assertEquals(JSON.stringify(row).includes("peer-"), false);
});

Deno.test("telemetry keeps a number as null when the peer had none, or it is negative", async () => {
  const { store, app } = shell();
  const original = console.log;
  console.log = () => {};
  try {
    const response = await app(post({
      kind: "summary",
      session: "test-session",
      role: "host",
      test: true,
      route: "none",
      rttMs: null,
      frameMeanMs: -4,
    }));
    assertEquals(response.status, 200);
  } finally {
    console.log = original;
  }
  const [row] = await store.listTelemetry("test-session");
  assertEquals(
    [row.role, row.rttMs, row.frameMeanMs, row.players, row.test],
    ["host", null, null, null, true],
  );
});

Deno.test("only a summary is stored; connection and error events stay in the log", async () => {
  const { store, app } = shell();
  const original = console.log;
  console.log = () => {};
  try {
    for (const kind of ["connection", "error"]) {
      const response = await app(
        post({ kind, session: "test-session", status: "connected" }),
      );
      assertEquals(response.status, 200);
    }
  } finally {
    console.log = original;
  }
  assertEquals(await store.listTelemetry("test-session"), []);
});

Deno.test("telemetry keeps its input validation", async () => {
  const { store, app } = shell();
  for (
    const body of [
      { kind: "other", session: "test-session" },
      { kind: "summary" },
      { kind: "summary", session: "short" },
      { kind: "summary", session: "bad session!" },
    ]
  ) {
    const response = await app(post(body));
    assertEquals(response.status, 400, JSON.stringify(body));
    await response.body?.cancel();
  }
  const big = await app(
    new Request("http://localhost/api/telemetry", {
      method: "POST",
      headers: { "content-length": "5000" },
      body: "{}",
    }),
  );
  assertEquals(big.status, 413);
  await big.body?.cancel();
  assertEquals(await store.listTelemetry("test-session"), []);
});

Deno.test("a session has a direct join page and local QR image", async () => {
  const { app } = shell();
  const session = "test-session";
  const page = await app(new Request(`http://localhost/join/${session}`));
  assertEquals(page.status, 200);
  assertStringIncludes(await page.text(), "Open Dwarf");
  const qr = await app(new Request(`http://localhost/api/qr/${session}`));
  assertEquals(qr.status, 200);
  assertEquals(qr.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assertStringIncludes(await qr.text(), "<svg");
});

Deno.test("the API answers under /api/v1 and /host serves the page", async () => {
  const { app } = shell();
  const qr = await app(new Request("http://localhost/api/v1/qr/test-session"));
  assertEquals(qr.status, 200);
  await qr.body?.cancel();
  const sessions = await app(new Request("http://localhost/api/v1/sessions"));
  assertEquals(sessions.status, 200);
  assertEquals(await sessions.json(), { sessions: [] });
  assertEquals((await app(new Request("http://localhost/host"))).status, 200);
  for (const gone of ["/admin", "/phone-test"]) {
    assertEquals(
      (await app(new Request(`http://localhost${gone}`))).status,
      404,
    );
  }
});

Deno.test("a QR code opens the build's own join link only", () => {
  const request = new Request("http://localhost/api/v1/qr/test-session");
  const own = "http://localhost/join/test-session";
  assertEquals(joinLink(request, "test-session", null), own);
  assertEquals(
    joinLink(
      request,
      "test-session",
      "http://localhost/b/test/join/test-session?x=1",
    ),
    "http://localhost/b/test/join/test-session",
  );
  for (
    const link of [
      "https://od.example.me/b/test/join/test-session",
      "http://localhost/b/test/join/other-session",
      "https://od.example.me/anything",
      "javascript:alert(1)",
      "not a url",
    ]
  ) assertEquals(joinLink(request, "test-session", link), own);
});
