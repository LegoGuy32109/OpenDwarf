# Debugging with Playwright

Open Dwarf treats browser automation as a developer-facing product surface,
not an internal test script. The `@opendwarf/debugger` package wraps
Playwright with high-level primitives for inspecting game state, simulating
multiple players, and replaying interactions.

## Why Playwright

The game runs in a real browser: WebGL canvas, WebAssembly engine, WebRTC
data channels. Headless Playwright runs the same code path as a real player,
which means a debugging session has the same behavior as production. No
mocks, no fake transports.

The debugger sits on top of Playwright — anything you can do with raw
`@playwright/test` is still available via `debug.page(playerId)`.

## Quickstart

```ts
import { createGameDebugger } from "@opendwarf/debugger";

const debug = await createGameDebugger({
  baseUrl: "http://localhost:8000",
  headless: true,           // default true; pass false to watch
  recordTrace: true,        // capture interaction trace for replay
});

const alice = await debug.connectPlayer("Alice");
await alice.performAction("move", { x: 10, y: 5 });

await debug.waitForState((s) => s.players.length === 1);
const snap = await debug.captureSnapshot();

await debug.close();
```

## Core API

### `createGameDebugger(options)`

| Option            | Type        | Default                  | Notes                                  |
| ----------------- | ----------- | ------------------------ | -------------------------------------- |
| `baseUrl`         | `string`    | `http://localhost:8000`  | Where the game is served.              |
| `headless`        | `boolean`   | `true`                   | Set `false` to see browser windows.    |
| `recordTrace`     | `boolean`   | `false`                  | Stream interactions to disk for replay.|
| `tracePath`       | `string`    | `exports/traces/`        | Where traces land.                     |
| `launchArgs`      | `string[]`  | sensible WebGL defaults  | Forwarded to Chromium.                 |

Returns a `GameDebugger`.

### Connecting players

```ts
const alice = await debug.connectPlayer("Alice");
const bob   = await debug.connectPlayer("Bob");

alice.id           // stable player id
alice.page         // raw Playwright Page (escape hatch)
alice.performAction(action, payload?)
alice.send(message)
alice.disconnect()
```

Each player gets its own browser context — cookies, storage, and WebRTC
state are isolated.

### State assertions

```ts
await debug.waitForState((state) => state.players.length === 2);
await debug.waitForPlayer(alice.id);
await debug.waitForEvent("siege.start", { timeout: 30_000 });
```

All `waitFor*` helpers are **state-based**, not time-based. They poll the
live game state — no `sleep()` calls in your tests.

### Snapshots

```ts
const snapshot = await debug.captureSnapshot();
// {
//   tick: 1234,
//   players: [...],
//   tiles: [...],
//   entities: [...],
//   takenAt: "2026-06-04T18:00:00Z"
// }

await debug.saveSnapshot("./snapshots/before-siege.json");
```

Snapshots are deterministic representations of the engine state at a tick.
They can be diffed, persisted, and used to seed integration tests.

### Screenshots

```ts
await debug.screenshot({ path: "exports/screenshots/scene.png" });
await alice.screenshot({ path: "exports/screenshots/alice.png" });
```

### Reliability helpers

Brittle waits are the main reason browser automation rots. The debugger
exposes a small set of robust primitives:

```ts
await debug.safeClick(locator);                // retries on detach/cover
await debug.safeAction(action);                // retries action, validates effect
await debug.retryUntil(
  () => alice.performAction("forage"),
  (state) => state.player(alice.id).inventory.has("berries"),
  { attempts: 5, intervalMs: 250 },
);
```

These wrap Playwright's auto-waiting with game-state validation: an action
isn't considered "done" until the world reflects it.

## Recording and replaying interactions

```ts
const recording = await debug.startRecording();

await alice.performAction("move", { x: 1, y: 1 });
await alice.performAction("dig",  { x: 1, y: 2 });

const trace = await recording.stop();
await trace.save("./traces/dig-tunnel.json");
```

Replay any trace later:

```ts
const trace = await debug.loadTrace("./traces/dig-tunnel.json");
await debug.replay(trace, { speed: 2.0 });
```

Replays drive real browser clients — exactly the behavior the original
session produced.

## Multiplayer debugging patterns

### Verify peer sync

```ts
const [alice, bob] = await Promise.all([
  debug.connectPlayer("Alice"),
  debug.connectPlayer("Bob"),
]);

await alice.performAction("place-flag", { x: 0, y: 0 });

await debug.waitForState((s) => {
  const flag = s.entities.find((e) => e.kind === "flag");
  return !!flag;
}, { from: bob.id });  // assert from Bob's perspective
```

### Inspect divergence

```ts
const fromAlice = await alice.captureLocalState();
const fromBob   = await bob.captureLocalState();
const diff      = debug.diffStates(fromAlice, fromBob);

if (diff.length) {
  await debug.saveSnapshot("./desync.json");
  throw new Error(`Desync: ${diff.length} differences`);
}
```

## Integration with Playwright Test

You can use the debugger inside any `@playwright/test` file:

```ts
import { test, expect } from "@playwright/test";
import { createGameDebugger } from "@opendwarf/debugger";

test("two players see each other", async () => {
  const debug = await createGameDebugger({ baseUrl: "http://localhost:8000" });
  const alice = await debug.connectPlayer("Alice");
  const bob   = await debug.connectPlayer("Bob");

  await debug.waitForState((s) => s.players.length === 2);

  expect(await alice.seesPlayer(bob.id)).toBe(true);
  expect(await bob.seesPlayer(alice.id)).toBe(true);

  await debug.close();
});
```

Run with `deno task test`.

## Where traces and reports land

- HTML report: `exports/playwright-report/`
- Raw results: `exports/playwright-results/`
- Recorded traces: `exports/traces/`
- Snapshots: wherever you point `saveSnapshot()` at

## Design principles

- **State-based, not time-based.** Never `sleep()` — wait on observable state.
- **Reproducible.** Traces are deterministic; same seed + same trace → same outcome.
- **Real browsers, no mocks.** WebGL, WASM, and WebRTC all run for real.
- **Escape hatches.** Every wrapper exposes the underlying Playwright object.
- **Clear errors.** Failed waits include the last observed state, not just "timed out".
