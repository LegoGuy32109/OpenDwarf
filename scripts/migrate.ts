// Applies the numbered migrations to the database named by TURSO_DB_URL and TURSO_DB_TOKEN.
// `deno task db:migrate` loads `.env`; `deno task db:migrate:prod` loads `.env.prod`.
import { createClient } from "@tursodatabase/serverless/compat";
import { migrateDatabase } from "../src/server/migrations.ts";

const url = Deno.env.get("TURSO_DB_URL");
const authToken = Deno.env.get("TURSO_DB_TOKEN");
if (!url || !authToken) {
  console.error("TURSO_DB_URL and TURSO_DB_TOKEN must be set");
  Deno.exit(1);
}
try {
  const applied = await migrateDatabase(createClient({ url, authToken }));
  console.log(
    applied.length ? `applied ${applied.join(", ")}` : "no pending migrations",
  );
} catch (error) {
  // The message only: a client error object can carry the connection settings.
  console.error(
    `migration failed: ${error instanceof Error ? error.message : "unknown"}`,
  );
  Deno.exit(1);
}
