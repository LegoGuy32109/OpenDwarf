# API Reference

This document lists every public type and function exported from
`@opendwarf/sdk` and `@opendwarf/debugger`.

For prose explanations see [Modding API](./modding-api.md) and
[Debugging with Playwright](./debugging-with-playwright.md).

---

## `@opendwarf/sdk`

### `createMod(definition): Mod`

Factory for a mod. The default export of every mod file must be a `Mod`.

```ts
function createMod(definition: ModDefinition): Mod;
```

### `ModDefinition`

```ts
interface ModDefinition {
  // Manifest
  name: string;
  version?: string;
  description?: string;
  author?: string;
  dependencies?: string[];        // e.g. ["weather-mod@^1.0.0"]

  // Lifecycle hooks (all optional)
  onPlayerJoin?(ctx: GameContext, player: Player): void | Promise<void>;
  onPlayerLeave?(ctx: GameContext, player: Player): void | Promise<void>;
  onTick?(ctx: GameContext): void | Promise<void>;
  onMessage?(ctx: GameContext, msg: GameMessage): void | Promise<void>;
  onAction?(ctx: GameContext, action: GameAction): void | Promise<void>;
  onStateChange?(ctx: GameContext, change: StateChange): void | Promise<void>;
}
```

### `Mod`

Opaque value returned by `createMod()`. Treat as `unknown` — the runtime
inspects it.

### `ModManifest`

```ts
interface ModManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies: string[];
}
```

### `GameContext`

Passed to every hook. The only handle into the running game.

```ts
interface GameContext {
  broadcast(message: string | GameMessage): void;

  players: {
    list(): Player[];
    get(id: PlayerId): Player | undefined;
    count(): number;
    kick(id: PlayerId, reason?: string): void;
  };

  world: {
    spawn(kind: EntityKind, opts?: SpawnOptions): EntityId;
    despawn(id: EntityId): void;
    tiles: {
      at(x: number, y: number): Tile | undefined;
    };
  };

  state: {
    get(): GameState;
    update(recipe: (draft: GameState) => void): void;
    subscribe(fn: (next: GameState, prev: GameState) => void): Unsubscribe;
  };

  log: {
    info(msg: unknown): void;
    warn(msg: unknown): void;
    error(msg: unknown): void;
  };

  rng: {
    int(min: number, max: number): number;
    float(): number;
    pick<T>(items: readonly T[]): T;
  };

  tick: number;        // current simulation tick
  now(): number;       // monotonic ms since server start
}
```

### `Player`

```ts
interface Player {
  id: PlayerId;
  name: string;
  joinedAt: number;
  position: { x: number; y: number };
  stats: { hp: number; hunger: number; thirst: number; energy: number };
  inventory: ReadonlyMap<ItemKind, number>;
}

type PlayerId = string & { readonly __brand: "PlayerId" };
```

### `GameState`

An immutable snapshot of the world at a tick.

```ts
interface GameState {
  tick: number;
  seed: number;
  players: ReadonlyArray<Player>;
  entities: ReadonlyArray<Entity>;
  tiles: TileGrid;
  weather: Weather;
}
```

### `GameAction`

```ts
type GameAction =
  | { kind: "move";  x: number; y: number }
  | { kind: "dig";   x: number; y: number }
  | { kind: "build"; x: number; y: number; structure: StructureKind }
  | { kind: "attack"; targetId: EntityId }
  | { kind: "use";   itemId: ItemId; targetId?: EntityId }
  | { kind: "custom"; name: string; payload: unknown };
```

### `GameEvent`

```ts
type GameEvent =
  | { kind: "player.join";  player: Player }
  | { kind: "player.leave"; playerId: PlayerId }
  | { kind: "entity.spawn"; entity: Entity }
  | { kind: "entity.death"; entityId: EntityId }
  | { kind: "weather.change"; from: Weather; to: Weather }
  | { kind: "custom"; name: string; payload: unknown };
```

### `GameMessage` / `StateChange`

```ts
interface GameMessage {
  from?: PlayerId;          // omitted = server/mod broadcast
  text: string;
  kind?: "chat" | "system" | "alert";
}

interface StateChange {
  tick: number;
  events: GameEvent[];
}
```

### Helpers

```ts
function isPlayer(v: unknown): v is Player;
function tilesAround(state: GameState, x: number, y: number, r: number): Tile[];
function distance(a: { x: number; y: number }, b: { x: number; y: number }): number;
```

---

## `@opendwarf/debugger`

### `createGameDebugger(options): Promise<GameDebugger>`

```ts
function createGameDebugger(options: DebuggerOptions): Promise<GameDebugger>;

interface DebuggerOptions {
  baseUrl?: string;          // default "http://localhost:8000"
  headless?: boolean;        // default true
  recordTrace?: boolean;     // default false
  tracePath?: string;        // default "exports/traces/"
  launchArgs?: string[];     // forwarded to Chromium
  timeoutMs?: number;        // default 30_000 for waits
}
```

### `GameDebugger`

```ts
interface GameDebugger {
  connectPlayer(name: string): Promise<DebugPlayer>;

  waitForState(
    predicate: (state: GameState) => boolean,
    opts?: { timeout?: number; from?: PlayerId },
  ): Promise<GameState>;
  waitForPlayer(id: PlayerId, opts?: { timeout?: number }): Promise<Player>;
  waitForEvent(
    name: GameEvent["kind"] | string,
    opts?: { timeout?: number },
  ): Promise<GameEvent>;

  captureSnapshot(): Promise<Snapshot>;
  saveSnapshot(path: string): Promise<void>;
  diffStates(a: GameState, b: GameState): StateDiff[];

  screenshot(opts: { path: string }): Promise<void>;

  safeClick(locator: Locator): Promise<void>;
  safeAction(action: GameAction): Promise<void>;
  retryUntil<T>(
    fn: () => Promise<T>,
    predicate: (state: GameState) => boolean,
    opts?: { attempts?: number; intervalMs?: number },
  ): Promise<T>;

  startRecording(): Promise<Recording>;
  loadTrace(path: string): Promise<Trace>;
  replay(trace: Trace, opts?: { speed?: number }): Promise<void>;

  page(playerId: PlayerId): Page;   // raw Playwright Page
  close(): Promise<void>;
}
```

### `DebugPlayer`

```ts
interface DebugPlayer {
  id: PlayerId;
  name: string;
  page: Page;                       // raw Playwright Page

  performAction(action: GameAction["kind"], payload?: unknown): Promise<void>;
  send(message: string | GameMessage): Promise<void>;
  captureLocalState(): Promise<GameState>;
  seesPlayer(id: PlayerId): Promise<boolean>;
  screenshot(opts: { path: string }): Promise<void>;
  disconnect(): Promise<void>;
}
```

### `Snapshot`, `Recording`, `Trace`

```ts
interface Snapshot {
  tick: number;
  takenAt: string;          // ISO timestamp
  state: GameState;
}

interface Recording {
  stop(): Promise<Trace>;
}

interface Trace {
  startedAt: string;
  endedAt: string;
  steps: ReadonlyArray<TraceStep>;
  save(path: string): Promise<void>;
}

interface TraceStep {
  tick: number;
  playerId: PlayerId;
  action: GameAction;
}

interface StateDiff {
  path: string;             // dotted path into GameState
  before: unknown;
  after: unknown;
}
```

---

## Versioning

Both packages follow [semver](https://semver.org/). Public surface in this
document is stable within a major version. Anything not listed here is
internal and subject to change without notice.
