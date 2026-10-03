import { assertEquals, assertNotEquals } from "@std/assert";
import { createMemoryStore, openStore } from "../../src/server/store.ts";
import { cases, type Harness } from "./store_cases.ts";

function memoryHarness(): Harness {
  let now = 0;
  const store = createMemoryStore({
    now: () => now,
    heartbeatTimeoutMs: 10_000,
  });
  return { store, setNow: (ms) => now = ms, empty: true };
}

for (const [name, run] of Object.entries(cases)) {
  Deno.test(`memory store: ${name}`, async () => {
    await run(memoryHarness(), crypto.randomUUID().slice(0, 8));
  });
}

Deno.test("openStore falls back to the memory store without credentials", async () => {
  const env = ["TURSO_DB_URL", "TURSO_DB_TOKEN"];
  const saved = env.map((key) => Deno.env.get(key));
  env.forEach((key) => Deno.env.delete(key));
  try {
    const store = openStore();
    assertEquals(await store.getMain(), null);
    await store.setLabel({ name: "dev", kind: "branch", target: "main" });
    assertEquals((await store.listLabels()).length, 1);
  } finally {
    env.forEach((key, i) => {
      if (saved[i] !== undefined) Deno.env.set(key, saved[i]);
    });
  }
});

Deno.test("openStore with credentials holds them only inside the client", () => {
  const secret = "tok-secret-value-123";
  const url = "libsql://secret-host.example.turso.io";
  const saved = [Deno.env.get("TURSO_DB_URL"), Deno.env.get("TURSO_DB_TOKEN")];
  Deno.env.set("TURSO_DB_URL", url);
  Deno.env.set("TURSO_DB_TOKEN", secret);
  const logged: string[] = [];
  const originals = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = (...v: unknown[]) =>
    logged.push(v.join(" "));
  try {
    const store = openStore();
    assertNotEquals(store, undefined);
    // No store property carries a credential, and constructing it logs nothing.
    const shown = JSON.stringify(store) + Object.keys(store).join() +
      Object.values(store).map((v) => String(v)).join();
    assertEquals(shown.includes(secret) || shown.includes(url), false);
    assertEquals(logged, []);
  } finally {
    [console.log, console.error, console.warn] = originals;
    ["TURSO_DB_URL", "TURSO_DB_TOKEN"].forEach((key, i) => {
      if (saved[i] !== undefined) Deno.env.set(key, saved[i]);
      else Deno.env.delete(key);
    });
  }
});
