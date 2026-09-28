import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "../../src/server/app.ts";

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
