// Numbered SQL migrations for the shell's database, run by `deno task db:migrate`. The runner
// records each applied file and its checksum in `schema_migrations`, so a second run applies
// nothing and an edited migration is refused. The pattern follows the learn repository.

/** The two calls the runner needs. The Turso client and a test fake both satisfy it. */
export interface MigrationDb {
  execute(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  batch(
    statements: (string | { sql: string; args: (string | number)[] })[],
    mode?: "write" | "read" | "deferred" | "immediate",
  ): Promise<unknown>;
}

export interface Migration {
  version: string;
  sql: string;
  checksum: string;
}

const directory = new URL("../../migrations/", import.meta.url);

function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Every migration file in `migrations/`, in order, with its checksum. */
export async function migrationHistory(): Promise<Migration[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && /^\d{3}_[a-z0-9_]+\.sql$/.test(entry.name)) {
      names.push(entry.name);
    }
  }
  return await Promise.all(
    names.sort().map(async (version) => {
      const sql = await Deno.readTextFile(new URL(version, directory));
      return { version, sql, checksum: await sha256(sql) };
    }),
  );
}

/** The ledger a database reports: version to checksum for every applied migration. */
export async function appliedLedger(
  db: MigrationDb,
): Promise<Map<string, string>> {
  await db.execute(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const applied = await db.execute(
    "SELECT version, checksum FROM schema_migrations",
  );
  return new Map(
    applied.rows.map((row) => [String(row.version), String(row.checksum)]),
  );
}

/**
 * The migrations in `history` that `applied` does not record, in order. Throws when an applied
 * migration's file changed since it ran.
 */
export function pendingAgainst(
  history: Migration[],
  applied: Map<string, string>,
): Migration[] {
  const pending: Migration[] = [];
  for (const migration of history) {
    const checksum = applied.get(migration.version);
    if (checksum && checksum !== migration.checksum) {
      throw new Error(
        `migration ${migration.version} changed after application`,
      );
    }
    if (!checksum) pending.push(migration);
  }
  return pending;
}

/** Applies every pending migration, each in one transaction. Returns the versions it applied. */
export async function migrateDatabase(db: MigrationDb): Promise<string[]> {
  const pending = pendingAgainst(
    await migrationHistory(),
    await appliedLedger(db),
  );
  for (const migration of pending) {
    await db.batch([
      ...splitStatements(migration.sql),
      {
        sql:
          "INSERT INTO schema_migrations(version, checksum, applied_at) VALUES (?, ?, ?)",
        args: [migration.version, migration.checksum, Date.now()],
      },
    ], "immediate");
  }
  return pending.map((migration) => migration.version);
}
