import { assertEquals } from "@std/assert";
import { byteRange, createMedia, mediaKey } from "../../src/server/media.ts";

const media = createMedia({
  dir: new URL("./fixtures/media/", import.meta.url),
});
const get = (path: string, headers: HeadersInit = {}) => {
  const url = new URL(`http://x${path}`);
  return media.handle(new Request(url, { headers }), url.pathname);
};

Deno.test("media keys are path segments with no dot files or traversal", () => {
  assertEquals(mediaKey("/media/music/a.ogg"), "music/a.ogg");
  assertEquals(mediaKey("/media/music/Blue%20Hour.ogg"), "music/Blue Hour.ogg");
  for (
    const bad of [
      "/media/",
      "/media/../.env",
      "/media/music/..%2F..%2F.env",
      "/media/.hidden",
      "/media/a//b",
      "/media/a%5Cb",
      "/media/%E0%A4%A",
      "/other/a.ogg",
    ]
  ) assertEquals(mediaKey(bad), null, bad);
});

Deno.test("byte ranges: start-end, open end, suffix, and out of range", () => {
  assertEquals(byteRange("bytes=0-3", 10), { start: 0, end: 3 });
  assertEquals(byteRange("bytes=4-", 10), { start: 4, end: 9 });
  assertEquals(byteRange("bytes=-3", 10), { start: 7, end: 9 });
  assertEquals(byteRange("bytes=5-99", 10), { start: 5, end: 9 });
  assertEquals(byteRange("bytes=10-", 10), null);
  assertEquals(byteRange("bytes=0-1,4-5", 10), null);
});

Deno.test("without a signer, media is served from the folder with ranges", async () => {
  const whole = await get("/media/music/a.ogg?v=abc");
  assertEquals(whole?.status, 200);
  assertEquals(whole?.headers.get("content-type"), "audio/ogg");
  assertEquals(await whole?.text(), "0123456789");
  const part = await get("/media/music/a.ogg", { range: "bytes=2-5" });
  assertEquals(part?.status, 206);
  assertEquals(part?.headers.get("content-range"), "bytes 2-5/10");
  assertEquals(await part?.text(), "2345");
  const bad = await get("/media/music/a.ogg", { range: "bytes=20-" });
  assertEquals(bad?.status, 416);
  await bad?.body?.cancel();
  assertEquals((await get("/media/music/missing.ogg"))?.status, 404);
  assertEquals((await get("/media/.env"))?.status, 404);
  assertEquals(await get("/api/v1/status"), null);
});

Deno.test("with a signer, media redirects to the signed link", async () => {
  const signed = createMedia({
    signer: (key) => Promise.resolve(`https://r2.example/${key}?sig=1`),
  });
  const response = await signed.handle(
    new Request("http://x/media/music/a.ogg?v=abc"),
    "/media/music/a.ogg",
  );
  assertEquals(response?.status, 302);
  assertEquals(
    response?.headers.get("location"),
    "https://r2.example/music/a.ogg?sig=1",
  );
  assertEquals(response?.headers.get("cache-control"), "private, max-age=300");
});
