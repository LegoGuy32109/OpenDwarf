// Tests for the R2 signer and the remote service worker loader (ADR 0007).
import { assertEquals, assertStringIncludes } from "@std/assert";
import { createR2Signer, signerFromEnv } from "../../src/server/r2.ts";
import { openMedia } from "../../src/server/media.ts";
import { cdnBase, createBuilds } from "../../src/server/builds.ts";
import { createApp } from "../../src/server/app.ts";
import { createMemoryStore } from "../../src/server/store.ts";

const DATE = () => new Date("2013-05-24T00:00:00Z");

Deno.test("the signer matches the AWS S3 presigned-URL example", async () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const sign = createR2Signer({
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    endpoint: "https://examplebucket.s3.amazonaws.com",
    bucket: "",
    region: "us-east-1",
    expires: 86400,
    now: DATE,
  });
  assertEquals(
    await sign("test.txt"),
    "https://examplebucket.s3.amazonaws.com/test.txt?" +
      "X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
  );
});

const r2 = (key: string) =>
  createR2Signer({
    accessKeyId: "id",
    secretAccessKey: "secret",
    endpoint: "https://acct.r2.cloudflarestorage.com",
    bucket: "opendwarf",
    now: DATE,
  })(key);

Deno.test("an R2 link is path style, region auto, valid for 3600 s", async () => {
  const url = new URL(await r2("music/a.ogg"));
  assertEquals(url.origin, "https://acct.r2.cloudflarestorage.com");
  assertEquals(url.pathname, "/opendwarf/music/a.ogg");
  assertEquals(
    url.searchParams.get("X-Amz-Credential"),
    "id/20130524/auto/s3/aws4_request",
  );
  assertEquals(url.searchParams.get("X-Amz-Expires"), "3600");
  assertEquals(url.searchParams.get("X-Amz-SignedHeaders"), "host");
  assertEquals(url.searchParams.get("X-Amz-Signature")?.length, 64);
});

Deno.test("key segments are encoded for S3: space as %20, slash kept", async () => {
  const url = await r2("music/Blue Hour (v2).ogg");
  assertStringIncludes(
    url,
    "/opendwarf/music/Blue%20Hour%20%28v2%29.ogg?",
  );
});

Deno.test("the query string of the request is not part of the signed key", async () => {
  const media = openMedia((name) =>
    ({
      R2_ACCESS_KEY_ID: "id",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      R2_BUCKET: "opendwarf",
    })[name]
  );
  const get = (target: string) => {
    const url = new URL(`http://x${target}`);
    return media.handle(new Request(url), url.pathname);
  };
  const response = await get("/media/music/a.ogg?v=abc123");
  assertEquals(response?.status, 302);
  assertEquals(response?.headers.get("cache-control"), "private, max-age=300");
  const location = new URL(response!.headers.get("location")!);
  assertEquals(location.pathname, "/opendwarf/music/a.ogg");
  assertEquals(location.searchParams.has("v"), false);
  assertEquals(location.search.includes("abc123"), false);
});

Deno.test("openMedia signs only when all four R2 variables are set", () => {
  const all: Record<string, string> = {
    R2_ACCESS_KEY_ID: "id",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
    R2_BUCKET: "opendwarf",
  };
  assertEquals(typeof signerFromEnv((n) => all[n]), "function");
  for (const missing of Object.keys(all)) {
    const some = { ...all, [missing]: "" };
    assertEquals(signerFromEnv((n) => some[n]), undefined, missing);
  }
  assertEquals(signerFromEnv(() => undefined), undefined);
});

const MAIN = "a".repeat(40);
const FEATURE = "b".repeat(40);
const PUSHED = "c0ffee0123456789abcdef0123456789abcdef01";

function loaderApp(localBuild = false) {
  const store = createMemoryStore();
  const refs: Record<string, string> = {
    "heads/feature": FEATURE,
    [PUSHED.slice(0, 7)]: PUSHED,
  };
  const fetcher = ((input: Request | URL | string) => {
    const ref = /\/commits\/(.+)$/.exec(String(input))?.[1];
    return Promise.resolve(
      ref !== undefined && refs[ref]
        ? new Response(refs[ref])
        : new Response("{}", { status: 422 }),
    );
  }) as typeof fetch;
  const builds = createBuilds({ store, fetch: fetcher, localBuild });
  const app = createApp(builds);
  return { store, get: (path: string) => app(new Request(`http://x${path}`)) };
}

Deno.test("the loader imports sw-main.js from the build's commit", async () => {
  const { store, get } = loaderApp();
  await store.promote({ commit: MAIN, label: "main" });
  const cases: [string, string][] = [
    ["/sw.js", MAIN],
    ["/b/feature/sw.js", FEATURE],
    [`/b/${PUSHED.slice(0, 7)}/sw.js`, PUSHED],
    [`/b/${FEATURE}/sw.js`, FEATURE],
  ];
  for (const [path, sha] of cases) {
    const response = await get(path);
    assertEquals(response.status, 200, path);
    assertEquals(
      response.headers.get("content-type"),
      "text/javascript; charset=utf-8",
    );
    assertEquals(response.headers.get("cache-control"), "no-cache");
    assertEquals(
      await response.text(),
      `importScripts("${cdnBase(sha)}js/sw-main.js"); // build ${sha}\n`,
      path,
    );
  }
});

Deno.test("the loader answers 404 for an unknown build, or for main before any promotion", async () => {
  const { get } = loaderApp();
  assertEquals((await get("/b/nope/sw.js")).status, 404);
  assertEquals((await get("/b/a%20b/sw.js")).status, 404);
  assertEquals((await get("/sw.js")).status, 404);
  // The build page's not-found page is HTML; the loader's 404 is not.
  assertEquals(
    (await get("/b/nope/sw.js")).headers.get("content-type")?.includes("html"),
    false,
  );
});

Deno.test("the local build keeps its own loader", async () => {
  const { get } = loaderApp(true);
  for (const path of ["/sw.js", "/b/local/sw.js"]) {
    assertEquals(
      await (await get(path)).text(),
      'importScripts("/js/sw-main.js"); // build local\n',
    );
  }
  assertEquals(
    (await get("/b/feature/sw.js")).headers.get("content-type"),
    "text/javascript; charset=utf-8",
  );
});
