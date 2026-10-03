import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp, joinLink } from "../../src/server/app.ts";

Deno.test("telemetry logs only approved fields", async () => {
  const kv = await Deno.openKv(":memory:");
  const logged: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => logged.push(values.join(" "));
  try {
    const response = await createApp(kv)(
      new Request(
        "http://localhost/api/telemetry",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "summary",
            session: "test-session",
            role: "guest",
            route: "relay/relay",
            rttMs: 103.43,
            draft: "private draft",
            message: "private message",
          }),
        },
      ),
    );
    assertEquals(response.status, 200);
    assertEquals(logged.length, 1);
    assertStringIncludes(logged[0], '"rttMs":103.43');
    assertEquals(logged[0].includes("private"), false);
  } finally {
    console.log = original;
    kv.close();
  }
});

Deno.test("a session has a direct join page and local QR image", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const app = createApp(kv);
    const session = "test-session";
    const page = await app(new Request(`http://localhost/join/${session}`));
    assertEquals(page.status, 200);
    assertStringIncludes(await page.text(), "Open Dwarf");
    const qr = await app(new Request(`http://localhost/api/qr/${session}`));
    assertEquals(qr.status, 200);
    assertEquals(
      qr.headers.get("content-type"),
      "image/svg+xml; charset=utf-8",
    );
    assertStringIncludes(await qr.text(), "<svg");
  } finally {
    kv.close();
  }
});

Deno.test("the API answers under /api/v1 and /host serves the page", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const app = createApp(kv);
    const session = "test-session";
    const qr = await app(new Request(`http://localhost/api/v1/qr/${session}`));
    assertEquals(qr.status, 200);
    const sessions = await app(
      new Request("http://localhost/api/v1/admin/sessions"),
    );
    assertEquals(sessions.status, 200);
    assertEquals(
      (await app(new Request("http://localhost/host"))).status,
      200,
    );
    for (const gone of ["/admin", "/phone-test"]) {
      assertEquals(
        (await app(new Request(`http://localhost${gone}`))).status,
        404,
      );
    }
  } finally {
    kv.close();
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
