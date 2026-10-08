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
  const root = createBuild(parseBuildConfig(null), "http://localhost:8000");
  assertEquals(
    root.joinLink(session, "http://localhost:8000"),
    `http://localhost:8000/join/${session}`,
  );
  assertEquals(root.apiUrl("ice"), "http://localhost:8000/api/v1/ice");
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

Deno.test("a same-origin API is a full URL on the page's origin, not the files' base", () => {
  // The shell serves /b/<name>/ with <base href> on jsDelivr and an empty api.
  const build = createBuild(
    parseBuildConfig(JSON.stringify({ base: "/b/main/", api: "" })),
    "https://od.joshhale.me",
  );
  assertEquals(
    build.apiUrl("sessions"),
    "https://od.joshhale.me/api/v1/sessions",
  );
});

Deno.test("a build reports its commit and label for a session, and the working tree reports local", () => {
  const remote = createBuild(
    parseBuildConfig(JSON.stringify({ commit: "abc1234", label: "demo" })),
  );
  assertEquals(remote.identity, { commit: "abc1234", label: "demo" });
  const local = createBuild(parseBuildConfig(null));
  assertEquals(local.identity, { commit: "local", label: null });
});

Deno.test("a guest on another build is sent to the host's build, and a guest on the same build stays", () => {
  const session = "abcdefgh-1234";
  const origin = "https://od.example.me";
  const hostBuild = {
    commit: "a".repeat(40),
    label: "demo",
    path: `/b/${"a".repeat(40)}/`,
  };
  const guest = createBuild(
    parseBuildConfig(
      JSON.stringify({ base: "/b/other/", commit: "b".repeat(40) }),
    ),
  );
  assertEquals(
    guest.joinRedirect(hostBuild, session, origin),
    `${origin}/b/${"a".repeat(40)}/join/${session}`,
  );
  const same = createBuild(
    parseBuildConfig(
      JSON.stringify({ base: "/b/demo/", commit: "a".repeat(40) }),
    ),
  );
  assertEquals(same.joinRedirect(hostBuild, session, origin), null);
  // The working tree is the commit "local" on both sides.
  const local = createBuild(parseBuildConfig(null));
  assertEquals(
    local.joinRedirect(
      { commit: "local", label: null, path: "/b/local/" },
      session,
      origin,
    ),
    null,
  );
  assertEquals(
    guest.joinRedirect(
      { commit: "local", label: null, path: "/b/local/" },
      session,
      origin,
    ),
    `${origin}/b/local/join/${session}`,
  );
});

Deno.test("a join response with no build, or a build path that is not a build path, never redirects", () => {
  const guest = createBuild(
    parseBuildConfig(JSON.stringify({ commit: "b".repeat(40) })),
  );
  const origin = "https://od.example.me";
  for (
    const host of [
      undefined,
      null,
      "x",
      {},
      { commit: "a".repeat(40) },
      { commit: "a", path: "//evil.example/" },
      { commit: "a", path: "https://evil.example/b/a/" },
      { commit: "a", path: "/elsewhere/" },
    ]
  ) assertEquals(guest.joinRedirect(host, "abcdefgh-1234", origin), null);
});

Deno.test("a media URL is on the shell origin, with the hash as its version", () => {
  const build = createBuild(
    parseBuildConfig('{"base":"/b/test/","commit":"abc"}'),
    "https://od.example.me",
  );
  assertEquals(
    build.mediaUrl("music/ACelticTale.ogg", "da90e0650632"),
    "https://od.example.me/media/music/ACelticTale.ogg?v=da90e0650632",
  );
  assertEquals(
    build.mediaUrl("music/Blue Hour.ogg"),
    "https://od.example.me/media/music/Blue%20Hour.ogg",
  );
});
