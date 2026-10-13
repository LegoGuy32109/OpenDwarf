import { createApp } from "../../src/server/app.ts";
import { openBuilds } from "../../src/server/builds.ts";
import { createRelay } from "../../src/server/relay.ts";
import { createLocalProvider } from "../../src/server/signaling.ts";
import { createMemoryStore } from "../../src/server/store.ts";
import type { SessionRoutesOptions } from "../../src/server/session-routes.ts";

/** A local signaling shell with an explicit clock and a fresh store. */
export function createLocalShell(
  now: () => number,
  options: SessionRoutesOptions = {},
) {
  const store = createMemoryStore({ now }), relay = createRelay();
  const app = createApp(openBuilds(store), undefined, {
    relay,
    provider: createLocalProvider(relay),
    secret: "test-secret",
    now,
    ...options,
  });
  return { store, relay, app };
}
