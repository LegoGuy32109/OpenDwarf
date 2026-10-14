// Wrap Deno's V8 profiles with the emitted source maps needed by Fallow.
import {
  mapEmittedSource,
  mergeV8Profiles,
  type V8Profile,
  type V8SourceMap,
} from "./fallow-v8.ts";
const [
  input = "exports/coverage/deno",
  output = "exports/coverage/fallow-v8.json",
] = Deno.args;
const root = new URL("../", import.meta.url);
const result: V8Profile[] = [];
const maps: Record<string, { lineLengths: number[]; data: V8SourceMap }> = {};
const info = await new Deno.Command(Deno.execPath(), {
  args: ["info", "--json"],
}).output();
if (!info.success) {
  throw new Error("Could not locate Deno's emitted source cache");
}
const cache = JSON.parse(new TextDecoder().decode(info.stdout)).typescriptCache;
let mapped = 0;

async function sourceMap(profile: V8Profile, source: string) {
  const url = new URL(profile.url);
  const generated = await Deno.readTextFile(
    `${cache}/file${decodeURIComponent(url.pathname)}.js`,
  );
  return mapEmittedSource(profile, source, generated);
}

for await (const entry of Deno.readDir(input)) {
  if (!entry.name.endsWith(".json")) continue;
  const profile: V8Profile = JSON.parse(
    await Deno.readTextFile(`${input}/${entry.name}`),
  );
  if (typeof profile.url !== "string" || !profile.url.startsWith(root.href)) {
    continue;
  }
  if (!/\.[jt]s$/.test(profile.url)) continue;
  const source = await Deno.readTextFile(new URL(profile.url));
  if (profile.url.endsWith(".ts")) {
    maps[profile.url] = await sourceMap(profile, source);
    mapped++;
  } else if (profile.functions?.[0]?.ranges?.[0]?.endOffset !== source.length) {
    throw new Error(
      `Coverage source changed or was transformed: ${profile.url}`,
    );
  }
  result.push(profile);
}
await Deno.writeTextFile(
  output,
  JSON.stringify({ result: mergeV8Profiles(result), "source-map-cache": maps }),
);
console.log(
  `Wrote ${result.length} profiles, including ${mapped} TypeScript profiles with source maps.`,
);
