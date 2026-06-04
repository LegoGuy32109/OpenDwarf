/**
 * @opendwarf/sdk — public TypeScript SDK for building Open Dwarf mods.
 *
 * See docs/modding-api.md for the prose explanation and
 * docs/api-reference.md for the full type listing.
 */

// ---------- branded ids ----------

export type PlayerId = string & { readonly __brand: "PlayerId" };
export type EntityId = string & { readonly __brand: "EntityId" };
export type ItemId = string & { readonly __brand: "ItemId" };

export const PlayerId = (s: string): PlayerId => s as PlayerId;
export const EntityId = (s: string): EntityId => s as EntityId;
export const ItemId = (s: string): ItemId => s as ItemId;

// ---------- world primitives ----------

export type EntityKind =
  | "dwarf"
  | "goblin"
  | "item"
  | "structure"
  | "flag"
  | (string & Record<never, never>);

export type ItemKind = string;
export type StructureKind = string;
export type Weather = "clear" | "raining" | "snowing" | "foggy";

export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface PlayerStats {
  readonly hp: number;
  readonly hunger: number;
  readonly thirst: number;
  readonly energy: number;
}

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly joinedAt: number;
  readonly position: Position;
  readonly stats: PlayerStats;
  readonly inventory: ReadonlyMap<ItemKind, number>;
}

export interface Entity {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly position: Position;
}

export interface Tile {
  readonly x: number;
  readonly y: number;
  readonly kind: string;
  readonly passable: boolean;
}

export interface TileGrid {
  readonly width: number;
  readonly height: number;
  at(x: number, y: number): Tile | undefined;
}

export interface GameState {
  readonly tick: number;
  readonly seed: number;
  readonly players: ReadonlyArray<Player>;
  readonly entities: ReadonlyArray<Entity>;
  readonly tiles: TileGrid;
  readonly weather: Weather;
}

// ---------- actions, events, messages ----------

export type GameAction =
  | { kind: "move"; x: number; y: number }
  | { kind: "dig"; x: number; y: number }
  | { kind: "build"; x: number; y: number; structure: StructureKind }
  | { kind: "attack"; targetId: EntityId }
  | { kind: "use"; itemId: ItemId; targetId?: EntityId }
  | { kind: "custom"; name: string; payload: unknown };

export type GameEvent =
  | { kind: "player.join"; player: Player }
  | { kind: "player.leave"; playerId: PlayerId }
  | { kind: "entity.spawn"; entity: Entity }
  | { kind: "entity.death"; entityId: EntityId }
  | { kind: "weather.change"; from: Weather; to: Weather }
  | { kind: "custom"; name: string; payload: unknown };

export interface GameMessage {
  readonly from?: PlayerId;
  readonly text: string;
  readonly kind?: "chat" | "system" | "alert";
}

export interface StateChange {
  readonly tick: number;
  readonly events: ReadonlyArray<GameEvent>;
}

// ---------- context ----------

export interface SpawnOptions {
  readonly x?: number;
  readonly y?: number;
  readonly near?: PlayerId | EntityId;
  readonly props?: Readonly<Record<string, unknown>>;
}

export type Unsubscribe = () => void;

export interface GameContext {
  broadcast(message: string | GameMessage): void;

  readonly players: {
    list(): Player[];
    get(id: PlayerId): Player | undefined;
    count(): number;
    kick(id: PlayerId, reason?: string): void;
  };

  readonly world: {
    spawn(kind: EntityKind, opts?: SpawnOptions): EntityId;
    despawn(id: EntityId): void;
    readonly tiles: {
      at(x: number, y: number): Tile | undefined;
    };
  };

  readonly state: {
    get(): GameState;
    update(recipe: (draft: GameState) => void): void;
    subscribe(fn: (next: GameState, prev: GameState) => void): Unsubscribe;
  };

  readonly log: {
    info(msg: unknown): void;
    warn(msg: unknown): void;
    error(msg: unknown): void;
  };

  readonly rng: {
    int(min: number, max: number): number;
    float(): number;
    pick<T>(items: readonly T[]): T;
  };

  readonly tick: number;
  now(): number;
}

// ---------- mod definition ----------

export interface ModManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly author?: string;
  readonly dependencies: ReadonlyArray<string>;
}

export type HookResult = void | Promise<void>;

export interface ModDefinition {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  dependencies?: string[];

  onPlayerJoin?(ctx: GameContext, player: Player): HookResult;
  onPlayerLeave?(ctx: GameContext, player: Player): HookResult;
  onTick?(ctx: GameContext): HookResult;
  onMessage?(ctx: GameContext, msg: GameMessage): HookResult;
  onAction?(ctx: GameContext, action: GameAction): HookResult;
  onStateChange?(ctx: GameContext, change: StateChange): HookResult;
}

export interface Mod {
  readonly __brand: "OpenDwarfMod";
  readonly manifest: ModManifest;
  readonly definition: ModDefinition;
}

/**
 * Declare an Open Dwarf mod. The default export of every mod file must be
 * the return value of `createMod()`.
 *
 * @example
 * export default createMod({
 *   name: "welcome-mod",
 *   onPlayerJoin(ctx, player) {
 *     ctx.broadcast(`${player.name} joined`);
 *   },
 * });
 */
export function createMod(definition: ModDefinition): Mod {
  if (!definition.name || typeof definition.name !== "string") {
    throw new Error("createMod: `name` is required and must be a string");
  }
  return {
    __brand: "OpenDwarfMod",
    manifest: {
      name: definition.name,
      version: definition.version ?? "0.0.0",
      description: definition.description,
      author: definition.author,
      dependencies: definition.dependencies ?? [],
    },
    definition,
  };
}

// ---------- helpers ----------

export function isPlayer(v: unknown): v is Player {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    "name" in v &&
    "position" in v &&
    "stats" in v
  );
}

export function distance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function tilesAround(
  state: GameState,
  x: number,
  y: number,
  r: number,
): Tile[] {
  const out: Tile[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const t = state.tiles.at(x + dx, y + dy);
      if (t) out.push(t);
    }
  }
  return out;
}
