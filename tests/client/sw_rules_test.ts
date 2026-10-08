import { assertEquals } from "@std/assert";

await import("../../public/js/sw-main.js");

type Range = { start: number; end: number } | "unsatisfiable" | null;
const rules = (globalThis as unknown as {
  odSw: {
    buildCacheName(commit: string): string;
    buildCommitOf(url: string, origin: string): string | null;
    isMedia(url: string, origin: string): boolean;
    buildCachesToDelete(
      names: string[],
      recent: string[],
      current: string,
    ): string[];
    parseRange(header: string | null, size: number): Range;
    answerRange(cached: Response, header: string | null): Promise<Response>;
  };
}).odSw;

const ORIGIN = "https://od.joshhale.me";
const SHA = "0123456789abcdef0123456789abcdef01234567";

Deno.test("a build's files go in a cache named for its commit", () => {
  assertEquals(rules.buildCacheName(SHA), `od-build-${SHA}`);
  assertEquals(rules.buildCacheName(""), "od-build-local");
  assertEquals(rules.buildCacheName("local"), "od-build-local");
});

Deno.test("only a build's own files are build files", () => {
  const jsd =
    `https://cdn.jsdelivr.net/gh/LegoGuy32109/OpenDwarf@${SHA}/public/`;
  assertEquals(rules.buildCommitOf(`${jsd}js/app.js`, ORIGIN), SHA);
  assertEquals(
    rules.buildCommitOf("https://cdn.jsdelivr.net/gh/a/b@main/x.js", ORIGIN),
    null,
  );
  assertEquals(rules.buildCommitOf(`${ORIGIN}/js/app.js`, ORIGIN), "local");
  assertEquals(
    rules.buildCommitOf(`${ORIGIN}/src/client/a.js`, ORIGIN),
    "local",
  );
  assertEquals(rules.buildCommitOf(`${ORIGIN}/api/v1/status`, ORIGIN), null);
  assertEquals(rules.buildCommitOf(`${ORIGIN}/media/a.ogg`, ORIGIN), null);
  assertEquals(
    rules.buildCommitOf("https://evil.example/js/a.js", ORIGIN),
    null,
  );
  assertEquals(rules.buildCommitOf("not a url", ORIGIN), null);
});

Deno.test("media is the shell's /media path", () => {
  assertEquals(
    rules.isMedia(`${ORIGIN}/media/music/a.ogg?v=1f2e`, ORIGIN),
    true,
  );
  assertEquals(rules.isMedia(`${ORIGIN}/api/media/a`, ORIGIN), false);
  assertEquals(rules.isMedia("https://x.example/media/a.ogg", ORIGIN), false);
});

Deno.test("the worker keeps the newest three build caches", () => {
  const names = [
    "od-media",
    "od-build-a",
    "od-build-b",
    "od-build-c",
    "od-build-d",
    "od-build-e",
  ];
  assertEquals(
    rules.buildCachesToDelete(names, ["d", "c", "b", "a"], "e"),
    ["od-build-a", "od-build-b"].sort(),
  );
  // The build in use is kept even when the list does not name it.
  assertEquals(
    rules.buildCachesToDelete(
      ["od-build-a", "od-build-b", "od-build-c", "od-build-d"],
      ["a", "b", "c"],
      "d",
    ),
    ["od-build-c"],
  );
  assertEquals(rules.buildCachesToDelete(["od-media"], ["a"], "a"), []);
});

Deno.test("a Range header reads against the body's size", () => {
  assertEquals(rules.parseRange("bytes=0-3", 10), { start: 0, end: 3 });
  assertEquals(rules.parseRange("bytes=4-", 10), { start: 4, end: 9 });
  assertEquals(rules.parseRange("bytes=8-99", 10), { start: 8, end: 9 });
  assertEquals(rules.parseRange("bytes=-4", 10), { start: 6, end: 9 });
  assertEquals(rules.parseRange("bytes=-99", 10), { start: 0, end: 9 });
  assertEquals(rules.parseRange("bytes=10-", 10), "unsatisfiable");
  assertEquals(rules.parseRange("bytes=5-2", 10), "unsatisfiable");
  assertEquals(rules.parseRange("bytes=0-1,4-5", 10), null);
  assertEquals(rules.parseRange("items=0-1", 10), null);
  assertEquals(rules.parseRange(null, 10), null);
});

Deno.test("a cached file answers a Range with 206 and Content-Range", async () => {
  const body = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const cached = () =>
    new Response(body, { headers: { "content-type": "audio/ogg" } });
  const part = await rules.answerRange(cached(), "bytes=2-5");
  assertEquals(part.status, 206);
  assertEquals(part.headers.get("content-range"), "bytes 2-5/10");
  assertEquals(part.headers.get("content-length"), "4");
  assertEquals(part.headers.get("content-type"), "audio/ogg");
  assertEquals([...new Uint8Array(await part.arrayBuffer())], [2, 3, 4, 5]);

  const tail = await rules.answerRange(cached(), "bytes=8-");
  assertEquals(tail.headers.get("content-range"), "bytes 8-9/10");

  const whole = await rules.answerRange(cached(), null);
  assertEquals(whole.status, 200);
  assertEquals((await whole.arrayBuffer()).byteLength, 10);

  const past = await rules.answerRange(cached(), "bytes=20-");
  assertEquals(past.status, 416);
  assertEquals(past.headers.get("content-range"), "bytes */10");
});
