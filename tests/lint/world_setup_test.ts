import { assertEquals } from "@std/assert";
Deno.test("scripted browser tests use the world driver instead of the manual __od tool", async () => {
  const failures: string[] = [];
  const folder = new URL("../e2e/", import.meta.url);
  for (const { name, source } of await typescriptSources(folder)) {
    if (/\b__od\b|\bremoveNpc\b/.test(source)) failures.push(name);
  }
  assertEquals(
    failures,
    [],
    "Use tests/e2e/world.ts to configure fixtures and observe the game",
  );
});
Deno.test("unit world fixtures use the shared builder", async () => {
  const failures: string[] = [];
  for (const dir of ["client", "shared"]) {
    const folder = new URL(`../${dir}/`, import.meta.url);
    for (const { name, source } of await typescriptSources(folder)) {
      if (
        /import\s*\{[^}]*\bcreateWorld\b[^}]*\}\s*from\s*["'][^"']*shared\/world\.js["']/
          .test(source)
      ) failures.push(`${dir}/${name}`);
    }
  }
  assertEquals(
    failures,
    [],
    "Construct fixture terrain with worldBuilder or createFixtureWorld",
  );
});

async function typescriptSources(folder: URL) {
  const sources: { name: string; source: string }[] = [];
  for await (const entry of Deno.readDir(folder)) {
    if (!entry.name.endsWith(".ts")) continue;
    sources.push({
      name: entry.name,
      source: await Deno.readTextFile(new URL(entry.name, folder)),
    });
  }
  return sources;
}
