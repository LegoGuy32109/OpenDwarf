import { assertEquals, assertRejects } from "@std/assert";
import { createTursoStore, type Label } from "../../src/server/store.ts";

type Client = Parameters<typeof createTursoStore>[0];
function labelDatabase(existing: Label | null) {
  const batches: unknown[][] = [];
  const db = {
    execute: () =>
      Promise.resolve({
        rows: existing
          ? [{
            name: existing.name,
            target_kind: existing.kind,
            target: existing.target,
            created_at: existing.created,
            updated_at: existing.updated,
          }]
          : [],
      }),
    batch: (statements: unknown[]) => {
      batches.push(statements);
      return Promise.resolve([]);
    },
  };
  return {
    store: createTursoStore(db as unknown as Client, { now: () => 100 }),
    batches,
  };
}
Deno.test("SQL labels record creation atomically with their history", async () => {
  const { store, batches } = labelDatabase(null);
  assertEquals(
    await store.setLabel({ name: "test", kind: "branch", target: "main" }),
    {
      name: "test",
      kind: "branch",
      target: "main",
      created: 100,
      updated: 100,
    },
  );
  assertEquals(batches.length, 1);
  assertEquals((batches[0] as { args: unknown[] }[]).map((row) => row.args), [[
    "test",
    "branch",
    "main",
    100,
    100,
  ], ["test", "created", "branch", "main", null, 100]]);
});
Deno.test("SQL labels preserve creation time on moves and skip unchanged writes", async () => {
  const existing: Label = {
    name: "test",
    kind: "branch",
    target: "main",
    created: 10,
    updated: 20,
  };
  const { store, batches } = labelDatabase(existing);
  assertEquals(
    await store.setLabel({ name: "test", kind: "branch", target: "main" }),
    existing,
  );
  assertEquals(batches, []);
  assertEquals(
    await store.setLabel({ name: "test", kind: "commit", target: "abcdef1" }),
    {
      name: "test",
      kind: "commit",
      target: "abcdef1",
      created: 10,
      updated: 100,
    },
  );
  assertEquals((batches[0] as { args: unknown[] }[])[1].args, [
    "test",
    "moved",
    "commit",
    "abcdef1",
    null,
    100,
  ]);
  await assertRejects(() =>
    store.setLabel({ name: "bad/name", kind: "branch", target: "main" })
  );
});
