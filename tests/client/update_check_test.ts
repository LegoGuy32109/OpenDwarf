import { assertEquals } from "@std/assert";
import { CHECK_MS, startUpdateCheck } from "../../src/client/update-check.js";

/** A fake clock, document, and `fetch` for the check. */
function rig(
  options: { host?: boolean; label?: string; reply?: () => Promise<Response> } =
    {},
) {
  const calls: string[] = [];
  const listeners = new Map<string, () => void>();
  const doc = {
    hidden: false,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  let tick: (() => void) | undefined;
  let interval = 0;
  let mainCommit = "aaaaaaa";
  let noticed = 0;
  const check = startUpdateCheck({
    host: options.host ?? true,
    build: { label: options.label ?? "main", commit: "aaaaaaa" },
    url: "https://od.test/api/v1/status",
    onNewer: () => noticed++,
    fetch: ((url: string) => {
      calls.push(url);
      return options.reply?.() ??
        Promise.resolve(Response.json({ main: { commit: mainCommit } }));
    }) as unknown as typeof fetch,
    document: doc,
    setInterval: (fn: () => void, ms: number) => {
      tick = fn;
      interval = ms;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {
      tick = undefined;
    },
  });
  return {
    check,
    calls,
    doc,
    listeners,
    get noticed() {
      return noticed;
    },
    get interval() {
      return interval;
    },
    moveMain: (commit: string) => mainCommit = commit,
    tick: async () => {
      tick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    show: () => listeners.get("visibilitychange")?.(),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

Deno.test("main moving shows the notice on the next check", async () => {
  const r = rig();
  assertEquals(r.interval, CHECK_MS);
  await r.tick();
  assertEquals(r.noticed, 0);
  r.moveMain("bbbbbbb");
  await r.tick();
  assertEquals(r.noticed, 1);
  assertEquals(r.calls[0], "https://od.test/api/v1/status");
  // It stops checking after it has told the host.
  assertEquals(r.listeners.size, 0);
  await r.tick();
  assertEquals(r.calls.length, 2);
});

Deno.test("the same commit does not show the notice", async () => {
  const r = rig();
  await r.tick();
  await r.tick();
  assertEquals(r.calls.length, 2);
  assertEquals(r.noticed, 0);
});

Deno.test("a guest or a non-main build never fetches", async () => {
  for (
    const options of [
      { host: false },
      { label: "t83-build-notice" },
      { label: "" },
    ]
  ) {
    const r = rig(options);
    r.moveMain("bbbbbbb");
    await r.tick();
    r.show();
    await settle();
    assertEquals(r.calls.length, 0);
    assertEquals(r.noticed, 0);
    assertEquals(r.listeners.size, 0);
  }
});

Deno.test("a failed fetch is ignored, and a later check still works", async () => {
  let fail = true;
  const r = rig({
    reply: () =>
      fail
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(Response.json({ main: { commit: "bbbbbbb" } })),
  });
  await r.tick();
  assertEquals(r.noticed, 0);
  fail = false;
  await r.tick();
  assertEquals(r.noticed, 1);
  const bad = rig({
    reply: () => Promise.resolve(new Response("no", { status: 500 })),
  });
  await bad.tick();
  const odd = rig({
    reply: () => Promise.resolve(Response.json({ main: null })),
  });
  await odd.tick();
  assertEquals(bad.noticed + odd.noticed, 0);
});

Deno.test("showing the tab again checks once, and a hidden tab does not", async () => {
  const r = rig();
  r.moveMain("bbbbbbb");
  r.doc.hidden = true;
  r.show();
  await settle();
  assertEquals(r.calls.length, 0);
  r.doc.hidden = false;
  r.show();
  await settle();
  assertEquals(r.calls.length, 1);
  assertEquals(r.noticed, 1);
});
