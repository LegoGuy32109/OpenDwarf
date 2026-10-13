// Wrap Deno's per-script V8 coverage in the envelope that Fallow reads.
// JavaScript runs unchanged. TypeScript profiles use emitted offsets and need
// source maps, so this adapter excludes them rather than assigning wrong coverage.
const [
  input = "exports/coverage/deno",
  output = "exports/coverage/fallow-v8.json",
] = Deno.args;
const result: { scriptId: string; url: string; functions: unknown[] }[] = [];
const root = new URL("../", import.meta.url);
let skipped = 0;
for await (const entry of Deno.readDir(input)) {
  if (!entry.name.endsWith(".json")) continue;
  const profile = JSON.parse(await Deno.readTextFile(`${input}/${entry.name}`));
  if (typeof profile.url !== "string" || !profile.url.startsWith(root.href)) {
    continue;
  }
  if (!profile.url.endsWith(".js")) {
    skipped++;
    continue;
  }
  const source = await Deno.readTextFile(new URL(profile.url));
  if (profile.functions?.[0]?.ranges?.[0]?.endOffset !== source.length) {
    throw new Error(
      `Coverage source changed or was transformed: ${profile.url}`,
    );
  }
  result.push(profile);
}
await Deno.writeTextFile(output, JSON.stringify({ result }));
console.log(
  `Wrote ${result.length} JavaScript profiles. ${skipped} TypeScript profiles need source maps.`,
);
