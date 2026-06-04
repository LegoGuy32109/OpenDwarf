/**
 * @opendwarf/server/mod-runtime — loads mods, resolves dependency order,
 * and dispatches lifecycle hooks against a sandboxed GameContext.
 *
 * Intentionally engine-agnostic: the runtime operates on an in-memory
 * `GameState` and a small set of pluggable effects. The Bevy bridge
 * implements those effects in production; tests and examples can drive the
 * runtime with the default in-memory effects.
 *
 * Error policy: a hook that throws is logged and that mod is disabled for
 * the remainder of the session. A misbehaving mod cannot crash the runtime.
 */

import type {
  EntityId,
  EntityKind,
  GameAction,
  GameContext,
  GameEvent,
  GameMessage,
  GameState,
  Mod,
  Player,
  PlayerId,
  SpawnOptions,
  StateChange,
  Tile,
  TileGrid,
  Weather,
} from "@opendwarf/sdk";

// ---------- public types ----------

export interface RuntimeOptions {
  initialState?: Partial<GameState>;
  effects?: Effects;
  logger?: Logger;
  seed?: number;
}

export interface ModRuntime {
  register(mod: Mod): RegistrationResult;
  registerMany(mods: Mod[]): RegistrationResult[];

  start(): Promise<void>;
  stop(): Promise<void>;

  /** Drive a single tick. Calls `onTick` and applies pending events. */
  tick(): Promise<void>;

  dispatch(playerId: PlayerId, action: GameAction): Promise<void>;
  playerJoin(player: Player): Promise<void>;
  playerLeave(playerId: PlayerId): Promise<void>;
  message(msg: GameMessage): Promise<void>;

  state(): GameState;
  loadedMods(): ReadonlyArray<LoadedMod>;
}

export interface RegistrationResult {
  ok: boolean;
  name: string;
  reason?: string;
}

export interface LoadedMod {
  readonly name: string;
  readonly version: string;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

export interface Logger {
  info(scope: string, msg: unknown): void;
  warn(scope: string, msg: unknown): void;
  error(scope: string, msg: unknown): void;
}

export interface Effects {
  spawn(kind: EntityKind, opts: SpawnOptions | undefined, state: GameState): EntityId;
  despawn(id: EntityId, state: GameState): void;
  broadcast(msg: GameMessage, state: GameState): void;
}

// ---------- factory ----------

export function createModRuntime(options: RuntimeOptions = {}): ModRuntime {
  const logger = options.logger ?? defaultLogger();
  const effects = options.effects ?? createInMemoryEffects();
  const seed = options.seed ?? 0;

  let state: MutableGameState = initState(options.initialState, seed);
  let running = false;
  const loaded: LoadedMod[] = [];
  const mods: InternalMod[] = [];
  const subscribers = new Set<
    (next: GameState, prev: GameState) => void
  >();

  const register = (mod: Mod): RegistrationResult => {
    if (mods.some((m) => m.manifest.name === mod.manifest.name)) {
      return {
        ok: false,
        name: mod.manifest.name,
        reason: "already registered",
      };
    }
    mods.push({ ...mod, disabled: false });
    loaded.push({
      name: mod.manifest.name,
      version: mod.manifest.version,
      disabled: false,
    });
    return { ok: true, name: mod.manifest.name };
  };

  const registerMany = (ms: Mod[]): RegistrationResult[] => ms.map(register);

  const resolveOrder = (): InternalMod[] => {
    const byName = new Map(mods.map((m) => [m.manifest.name, m]));
    const sorted: InternalMod[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function visit(name: string, requiredBy?: string) {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(
          `Mod dependency cycle detected involving ${name}` +
            (requiredBy ? ` (from ${requiredBy})` : ""),
        );
      }
      const m = byName.get(name);
      if (!m) {
        if (requiredBy) {
          throw new Error(
            `Mod ${requiredBy} requires ${name}, which is not registered`,
          );
        }
        return;
      }
      visiting.add(name);
      for (const dep of m.manifest.dependencies) {
        visit(parseDepName(dep), name);
      }
      visiting.delete(name);
      visited.add(name);
      sorted.push(m);
    }

    for (const m of mods) visit(m.manifest.name);
    return sorted;
  };

  const buildContext = (scope: string): GameContext => ({
    broadcast(message) {
      const msg: GameMessage = typeof message === "string"
        ? { text: message, kind: "system" }
        : message;
      effects.broadcast(msg, state);
    },
    players: {
      list: () => state.players.slice(),
      get: (id) => state.players.find((p) => p.id === id),
      count: () => state.players.length,
      kick: (id) => {
        state = { ...state, players: state.players.filter((p) => p.id !== id) };
      },
    },
    world: {
      spawn: (kind, opts) => {
        const id = effects.spawn(kind, opts, state);
        const entity = {
          id,
          kind,
          position: { x: opts?.x ?? 0, y: opts?.y ?? 0 },
        };
        state = { ...state, entities: [...state.entities, entity] };
        return id;
      },
      despawn: (id) => {
        effects.despawn(id, state);
        state = {
          ...state,
          entities: state.entities.filter((e) => e.id !== id),
        };
      },
      tiles: { at: (x, y) => state.tiles.at(x, y) },
    },
    state: {
      get: () => snapshotState(state),
      update: (recipe) => {
        const prev = snapshotState(state);
        const draft = structuredClone(prev) as MutableGameState;
        recipe(draft);
        state = mergeState(state, draft);
        for (const fn of subscribers) {
          try {
            fn(snapshotState(state), prev);
          } catch (e) {
            logger.warn(scope, ["subscriber threw", e]);
          }
        }
      },
      subscribe: (fn) => {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },
    },
    log: {
      info: (m) => logger.info(scope, m),
      warn: (m) => logger.warn(scope, m),
      error: (m) => logger.error(scope, m),
    },
    rng: makeRng(seed + state.tick),
    tick: state.tick,
    now: () => Date.now(),
  });

  const runHook = async <Args extends unknown[]>(
    name: string,
    impl: (ctx: GameContext, ...args: Args) => void | Promise<void>,
    args: Args,
    mod: InternalMod,
  ) => {
    if (mod.disabled) return;
    try {
      await impl(buildContext(mod.manifest.name), ...args);
    } catch (e) {
      mod.disabled = true;
      const entry = loaded.find((l) => l.name === mod.manifest.name);
      if (entry) {
        (entry as { disabled: boolean }).disabled = true;
        (entry as { disabledReason?: string }).disabledReason =
          `${name} hook threw: ${String(e)}`;
      }
      logger.error(
        mod.manifest.name,
        `${name} threw; mod disabled for this session: ${String(e)}`,
      );
    }
  };

  const dispatchToMods = async <Args extends unknown[]>(
    name: keyof InternalMod["definition"] & string,
    args: Args,
  ) => {
    for (const mod of resolveOrder()) {
      const impl = mod.definition[name] as
        | ((ctx: GameContext, ...a: Args) => void | Promise<void>)
        | undefined;
      if (!impl) continue;
      await runHook(name, impl, args, mod);
    }
  };

  return {
    register,
    registerMany,

    async start() {
      if (running) return;
      resolveOrder(); // validate up-front
      running = true;
    },

    async stop() {
      running = false;
    },

    async tick() {
      state.tick++;
      await dispatchToMods("onTick", []);
    },

    async dispatch(playerId, action) {
      const events: GameEvent[] = [];
      await dispatchToMods("onAction", [action]);
      const change: StateChange = { tick: state.tick, events };
      await dispatchToMods("onStateChange", [change]);
      void playerId;
    },

    async playerJoin(player) {
      state = { ...state, players: [...state.players, player] };
      await dispatchToMods("onPlayerJoin", [player]);
    },

    async playerLeave(playerId) {
      const player = state.players.find((p) => p.id === playerId);
      state = {
        ...state,
        players: state.players.filter((p) => p.id !== playerId),
      };
      if (player) await dispatchToMods("onPlayerLeave", [player]);
    },

    async message(msg) {
      await dispatchToMods("onMessage", [msg]);
    },

    state: () => snapshotState(state),
    loadedMods: () => loaded.slice(),
  };
}

// ---------- internals ----------

interface InternalMod extends Mod {
  disabled: boolean;
}

interface MutableGameState {
  tick: number;
  seed: number;
  players: Player[];
  entities: Array<{ id: EntityId; kind: EntityKind; position: { x: number; y: number } }>;
  tiles: TileGrid;
  weather: Weather;
}

function initState(
  override: Partial<GameState> | undefined,
  seed: number,
): MutableGameState {
  return {
    tick: override?.tick ?? 0,
    seed: override?.seed ?? seed,
    players: [...(override?.players ?? [])],
    entities: [...(override?.entities ?? [])],
    tiles: override?.tiles ?? emptyTiles(),
    weather: override?.weather ?? "clear",
  };
}

function emptyTiles(): TileGrid {
  return {
    width: 0,
    height: 0,
    at: (_x: number, _y: number): Tile | undefined => undefined,
  };
}

function snapshotState(s: MutableGameState): GameState {
  return {
    tick: s.tick,
    seed: s.seed,
    players: s.players,
    entities: s.entities,
    tiles: s.tiles,
    weather: s.weather,
  };
}

function mergeState(
  current: MutableGameState,
  draft: MutableGameState,
): MutableGameState {
  return {
    ...current,
    tick: draft.tick,
    weather: draft.weather,
    players: draft.players ?? current.players,
    entities: draft.entities ?? current.entities,
  };
}

function parseDepName(spec: string): string {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return at === -1 ? spec : spec.slice(0, at);
}

function makeRng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  return {
    float: next,
    int(min: number, max: number) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
  };
}

function defaultLogger(): Logger {
  const fmt = (scope: string, msg: unknown) => `[${scope}] ${formatMsg(msg)}`;
  return {
    info: (s, m) => console.log(fmt(s, m)),
    warn: (s, m) => console.warn(fmt(s, m)),
    error: (s, m) => console.error(fmt(s, m)),
  };
}

function formatMsg(m: unknown): string {
  if (m instanceof Error) return m.stack ?? m.message;
  if (typeof m === "string") return m;
  try {
    return JSON.stringify(m);
  } catch {
    return String(m);
  }
}

function createInMemoryEffects(): Effects {
  let entityCounter = 0;
  return {
    spawn: (_kind, _opts, _state) =>
      ("entity_" + (++entityCounter)) as EntityId,
    despawn: (_id, _state) => {},
    broadcast: (msg, _state) => {
      console.log(`[broadcast] ${msg.text}`);
    },
  };
}
