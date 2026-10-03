// Runs the shared store cases against Turso. Skipped unless TURSO_DB_URL and TURSO_DB_TOKEN are
// set. Use a scratch database: the cases write rows and never remove them, and the promotion cases
// change main.
import { createClient } from "@tursodatabase/serverless/compat";
import { migrateDatabase } from "../../src/server/migrations.ts";
import { createTursoStore } from "../../src/server/store.ts";
import { cases, type Harness } from "./store_cases.ts";

const url = Deno.env.get("TURSO_DB_URL");
const authToken = Deno.env.get("TURSO_DB_TOKEN");
const configured = Boolean(url && authToken);

for (const [name, run] of Object.entries(cases)) {
  Deno.test({
    name: `turso store: ${name}`,
    ignore: !configured,
    async fn() {
      const db = createClient({ url: url!, authToken: authToken! });
      await migrateDatabase(db);
      let now = Date.now();
      const harness: Harness = {
        store: createTursoStore(db, {
          now: () => now,
          heartbeatTimeoutMs: 10_000,
        }),
        setNow: (ms) => now = ms,
        empty: false,
      };
      await run(harness, crypto.randomUUID().slice(0, 8));
    },
  });
}
