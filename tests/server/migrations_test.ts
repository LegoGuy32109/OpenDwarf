import { assertEquals, assertThrows } from "@std/assert";
import {
  migrateDatabase,
  type Migration,
  type MigrationDb,
  migrationHistory,
  pendingAgainst,
} from "../../src/server/migrations.ts";

/** A database that understands only the ledger, and records every statement it is given. */
function fakeDb() {
  const ledger = new Map<string, string>();
  const statements: string[] = [];
  const db: MigrationDb = {
    execute(sql) {
      statements.push(sql);
      if (sql.startsWith("SELECT version, checksum")) {
        return Promise.resolve({
          rows: [...ledger].map(([version, checksum]) => ({
            version,
            checksum,
          })),
        });
      }
      return Promise.resolve({ rows: [] });
    },
    batch(batch) {
      for (const item of batch) {
        if (typeof item === "string") statements.push(item);
        else if (item.sql.startsWith("INSERT INTO schema_migrations")) {
          ledger.set(String(item.args[0]), String(item.args[1]));
        }
      }
      return Promise.resolve([]);
    },
  };
  return { db, ledger, statements };
}

Deno.test("migration files are numbered and in order", async () => {
  const history = await migrationHistory();
  assertEquals(history.length > 0, true);
  assertEquals(history[0].version, "001_initial.sql");
  assertEquals(
    history.map((m) => m.version),
    history.map((m) => m.version).toSorted(),
  );
  for (const migration of history) {
    assertEquals(migration.checksum.length, 64);
  }
});

Deno.test("migrating twice applies each migration once and records it", async () => {
  const { db, ledger, statements } = fakeDb();
  const history = await migrationHistory();
  assertEquals(await migrateDatabase(db), history.map((m) => m.version));
  assertEquals([...ledger.keys()], history.map((m) => m.version));
  assertEquals(
    statements.some((s) => s.startsWith("CREATE TABLE labels")),
    true,
  );
  const before = statements.length;
  assertEquals(await migrateDatabase(db), []);
  // The second run only reads the ledger.
  assertEquals(
    statements.slice(before).every((s) => !s.startsWith("CREATE TABLE labels")),
    true,
  );
});

Deno.test("an applied migration that changed is refused", () => {
  const history: Migration[] = [{
    version: "001_a.sql",
    sql: "x",
    checksum: "new",
  }];
  assertThrows(
    () => pendingAgainst(history, new Map([["001_a.sql", "old"]])),
    Error,
    "changed after application",
  );
  assertEquals(
    pendingAgainst(history, new Map()).map((m) => m.version),
    ["001_a.sql"],
  );
});
