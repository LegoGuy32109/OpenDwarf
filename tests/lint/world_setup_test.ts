import { assertEquals } from "@std/assert";
Deno.test("scripted browser tests use the world driver instead of the manual __od tool", async () => {
  const failures: string[] = [];
  const folder = new URL("../e2e/", import.meta.url);
  for await (const entry of Deno.readDir(folder)) {
    if (!entry.name.endsWith(".ts")) continue;
    const source = await Deno.readTextFile(new URL(entry.name, folder));
    if (/\b__od\b|\bremoveNpc\b/.test(source)) failures.push(entry.name);
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
    for await (const entry of Deno.readDir(folder)) {
      if (!entry.name.endsWith(".ts")) continue;
      const source = await Deno.readTextFile(new URL(entry.name, folder));
      if (
        /import\s*\{[^}]*\bcreateWorld\b[^}]*\}\s*from\s*["'][^"']*shared\/world\.js["']/
          .test(source)
      ) failures.push(`${dir}/${entry.name}`);
    }
  }
  assertEquals(
    failures,
    [],
    "Construct fixture terrain with worldBuilder or createFixtureWorld",
  );
});
