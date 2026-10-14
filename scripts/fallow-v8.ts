export interface V8Range {
  startOffset: number;
  endOffset: number;
  count: number;
}
export interface V8Function {
  functionName: string;
  isBlockCoverage: boolean;
  ranges: V8Range[];
}
export interface V8Profile {
  scriptId: string;
  url: string;
  functions: V8Function[];
}

/** Sum a segment's most specific count in each independent isolate. */
function countAt(profiles: V8Function[], offset: number): number {
  let count = 0;
  for (const profile of profiles) {
    let inner = profile.ranges[0];
    for (const range of profile.ranges) {
      if (
        range.startOffset <= offset && offset < range.endOffset &&
        range.endOffset - range.startOffset <=
          inner.endOffset - inner.startOffset
      ) inner = range;
    }
    count += inner.count;
  }
  return count;
}

function mergeFunction(profiles: V8Function[]): V8Function {
  const first = profiles[0];
  const outer = first.ranges[0];
  const cuts = [
    ...new Set(
      profiles.flatMap((profile) =>
        profile.ranges.flatMap((range) => [range.startOffset, range.endOffset])
      ),
    ),
  ].sort((a, b) => a - b);
  const root = {
    ...outer,
    count: profiles.reduce((sum, profile) => sum + profile.ranges[0].count, 0),
  };
  const ranges = [root];
  for (let i = 0; i < cuts.length - 1; i++) {
    const count = countAt(profiles, cuts[i]);
    if (count === root.count) continue;
    const last = ranges[ranges.length - 1];
    if (
      ranges.length > 1 && last.endOffset === cuts[i] && last.count === count
    ) last.endOffset = cuts[i + 1];
    else ranges.push({ startOffset: cuts[i], endOffset: cuts[i + 1], count });
  }
  return { ...first, ranges };
}

/** Merge independent V8 isolates without treating a missing child range as zero. */
export function mergeV8Profiles(profiles: V8Profile[]): V8Profile[] {
  const scripts = new Map<
    string,
    { first: V8Profile; functions: Map<string, V8Function[]> }
  >();
  for (const profile of profiles) {
    let script = scripts.get(profile.url);
    if (!script) {
      script = { first: profile, functions: new Map() };
      scripts.set(profile.url, script);
    }
    for (const fn of profile.functions) {
      const outer = fn.ranges[0];
      const key = `${outer.startOffset}:${outer.endOffset}:${fn.functionName}`;
      const list = script.functions.get(key) ?? [];
      list.push(fn);
      script.functions.set(key, list);
    }
  }
  return [...scripts.values()].map(({ first, functions }) => ({
    ...first,
    functions: [...functions.values()].map(mergeFunction),
  }));
}

export interface V8SourceMap {
  sources: string[];
  sourcesContent?: string[];
}
/** Read Deno's embedded source map only when emitted and original sources match the profile. */
export function mapEmittedSource(
  profile: V8Profile,
  source: string,
  generated: string,
) {
  const marker = "//# sourceMappingURL=data:application/json;base64,";
  const start = generated.lastIndexOf(marker);
  if (start < 0 || profile.functions[0].ranges[0].endOffset !== start) {
    throw new Error(
      `Coverage does not match Deno's emitted source: ${profile.url}`,
    );
  }
  const data: V8SourceMap = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        atob(generated.slice(start + marker.length).split("\n")[0]),
        (char) => char.charCodeAt(0),
      ),
    ),
  );
  if (
    data.sources.length !== 1 || data.sources[0] !== profile.url ||
    data.sourcesContent?.[0] !== source
  ) {
    throw new Error(
      `Coverage source changed or cannot be mapped: ${profile.url}`,
    );
  }
  return {
    lineLengths: generated.slice(0, start).split("\n").map((line) =>
      line.length
    ),
    data,
  };
}
