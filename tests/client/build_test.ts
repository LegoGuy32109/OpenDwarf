import { assertEquals } from "@std/assert";
import {
  createBuild,
  parseBuildConfig,
  readBuildConfig,
  routeOf,
} from "../../src/client/build.js";

Deno.test("a missing build config is a build at / on the same origin", () => {
  assertEquals(parseBuildConfig(null), {
    base: "/",
    api: "",
    label: "",
    commit: "",
  });
  assertEquals(readBuildConfig(undefined), parseBuildConfig(null));
  assertEquals(parseBuildConfig("{not json"), parseBuildConfig(null));
});

Deno.test("a build config sets base, API origin, label, and commit", () => {
  assertEquals(
    parseBuildConfig(JSON.stringify({
      base: "/b/test",
      api: "https://od.example.me/api/v1",
      label: "test",
      commit: "abc1234",
    })),
    {
      base: "/b/test/",
      api: "https://od.example.me",
      label: "test",
      commit: "abc1234",
    },
  );
});

Deno.test("a base that is not a path on this origin falls back to /", () => {
  for (
    const base of ["//evil.example/", "https://evil.example/", "b/test", 7]
  ) {
    assertEquals(parseBuildConfig(JSON.stringify({ base })).base, "/");
  }
  assertEquals(
    parseBuildConfig(JSON.stringify({ api: "javascript:alert(1)" })).api,
    "",
  );
});

Deno.test("routes are read under the base", () => {
  const session = "abcdefgh-1234";
  assertEquals(routeOf("/", "/"), { kind: "play" });
  assertEquals(routeOf("/host", "/"), { kind: "host" });
  assertEquals(routeOf(`/join/${session}`, "/"), { kind: "join", session });
  assertEquals(routeOf("/b/test/", "/b/test/"), { kind: "play" });
  assertEquals(routeOf("/b/test/host", "/b/test/"), { kind: "host" });
  assertEquals(routeOf(`/b/test/join/${session}`, "/b/test/"), {
    kind: "join",
    session,
  });
  // The old admin and phone test routes are gone.
  assertEquals(routeOf("/admin", "/"), { kind: "play" });
  assertEquals(routeOf("/phone-test", "/"), { kind: "play" });
  // A path outside the base, or a join under the wrong base, is not a join.
  assertEquals(routeOf(`/join/${session}`, "/b/test/"), { kind: "play" });
  assertEquals(routeOf(`/b/other/join/${session}`, "/b/test/"), {
    kind: "play",
  });
  assertEquals(routeOf("/join/short", "/"), { kind: "play" });
});

Deno.test("join links and API URLs carry the build's base and origin", () => {
  const session = "abcdefgh-1234";
  const root = createBuild(parseBuildConfig(null));
  assertEquals(
    root.joinLink(session, "http://localhost:8000"),
    `http://localhost:8000/join/${session}`,
  );
  assertEquals(root.apiUrl("ice"), "/api/v1/ice");
  const build = createBuild(
    parseBuildConfig(
      JSON.stringify({ base: "/b/test/", api: "https://od.example.me" }),
    ),
  );
  assertEquals(
    build.joinLink(session, "https://od.example.me"),
    `https://od.example.me/b/test/join/${session}`,
  );
  assertEquals(
    build.apiUrl(`signal/${session}/host`),
    `https://od.example.me/api/v1/signal/${session}/host`,
  );
});
