import { assertEquals, assertThrows } from "@std/assert";
import {
  mapEmittedSource,
  mergeV8Profiles,
  type V8Profile,
  type V8Range,
} from "../../scripts/fallow-v8.ts";

function profile(ranges: V8Range[], url = "file:///fixture.js"): V8Profile {
  return {
    scriptId: "1",
    url,
    functions: [{ functionName: "step", isBlockCoverage: true, ranges }],
  };
}
const range = (startOffset: number, endOffset: number, count: number) => ({
  startOffset,
  endOffset,
  count,
});

Deno.test("V8 coverage sums isolate calls and keeps uncovered segments", () => {
  const merged = mergeV8Profiles([
    profile([range(0, 100, 1), range(20, 30, 0)]),
    profile([range(0, 100, 2), range(20, 30, 0)]),
  ]);
  assertEquals(merged[0].functions[0].ranges, [
    range(0, 100, 3),
    range(20, 30, 0),
  ]);
});
Deno.test("V8 coverage inherits the parent count when another isolate has no child range", () => {
  const merged = mergeV8Profiles([
    profile([range(0, 100, 1), range(20, 30, 0)]),
    profile([range(0, 100, 2)]),
  ]);
  assertEquals(merged[0].functions[0].ranges, [
    range(0, 100, 3),
    range(20, 30, 2),
  ]);
});
Deno.test("V8 coverage partitions nested ranges before summing", () => {
  const merged = mergeV8Profiles([
    profile([range(0, 100, 1), range(10, 60, 0)]),
    profile([range(0, 100, 2), range(20, 40, 0), range(30, 35, 1)]),
  ]);
  assertEquals(merged[0].functions[0].ranges, [
    range(0, 100, 3),
    range(10, 20, 2),
    range(20, 30, 0),
    range(30, 35, 1),
    range(35, 40, 0),
    range(40, 60, 2),
  ]);
});
Deno.test("V8 coverage keeps different source URLs separate", () => {
  const merged = mergeV8Profiles([
    profile([range(0, 100, 1)]),
    profile([range(0, 100, 2)], "file:///other.js"),
  ]);
  assertEquals(merged.map((item) => item.functions[0].ranges[0].count), [1, 2]);
});

function emitted(source: string, code: string, url = "file:///fixture.ts") {
  const data = {
    version: 3,
    sources: [url],
    sourcesContent: [source],
    mappings: "AAAA",
  };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const encoded = btoa(
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
  );
  return code + "//# sourceMappingURL=data:application/json;base64," + encoded +
    "\n// cache metadata";
}
Deno.test("Deno source maps retain Unicode and generated UTF-16 line lengths", () => {
  const source = "const name:string = 'dwarf ⚒';";
  const code = "const name = 'dwarf ⚒';\n";
  const p = profile([range(0, code.length, 1)], "file:///fixture.ts");
  const mapped = mapEmittedSource(p, source, emitted(source, code));
  assertEquals(mapped.data.sourcesContent, [source]);
  assertEquals(mapped.lineLengths, [code.length - 1, 0]);
});
Deno.test("Deno source maps refuse stale source, stale emitted length and missing maps", () => {
  const code = "const n = 1;\n";
  const p = profile([range(0, code.length, 1)], "file:///fixture.ts");
  assertThrows(
    () => mapEmittedSource(p, "changed", emitted("original", code)),
    Error,
    "source changed",
  );
  assertThrows(
    () => mapEmittedSource(p, "original", emitted("original", code + "\n")),
    Error,
    "emitted source",
  );
  assertThrows(
    () => mapEmittedSource(p, "original", code),
    Error,
    "emitted source",
  );
  assertThrows(
    () =>
      mapEmittedSource(
        p,
        "original",
        emitted("original", code, "file:///other.ts"),
      ),
    Error,
    "cannot be mapped",
  );
});
