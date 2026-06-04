/**
 * @opendwarf/server/wasm-host — loads a Rust-authored Open Dwarf mod
 * compiled to wasm32-unknown-unknown and adapts it to the `Mod` shape the
 * existing ModRuntime already understands.
 *
 * The wasm-ness is invisible to the runtime: a wasm mod produces the same
 * `Mod` object as a TypeScript mod, so dispatch, error sandboxing, and
 * dependency resolution work uniformly across languages.
 *
 * ABI v1: see game_library/crates/opendwarf-sdk/src/lib.rs.
 *   - Returns from host imports that carry data are packed (ptr<<32)|len
 *     as a single i64. Guest is responsible for the buffer it gave us.
 *   - JSON is the wire format; swap to MessagePack/bincode behind a flag
 *     once we care.
 */

import type {
  GameAction,
  GameContext,
  GameMessage,
  Mod,
  ModManifest,
  Player,
} from "@opendwarf/sdk";

interface WasmExports {
  memory: WebAssembly.Memory;
  _opendwarf_abi_version: () => number;
  _opendwarf_alloc: (size: number) => number;
  _opendwarf_free: (ptr: number, size: number) => void;
  _opendwarf_manifest: () => bigint;
  _opendwarf_on_player_join?: (ptr: number, len: number) => void;
  _opendwarf_on_player_leave?: (ptr: number, len: number) => void;
  _opendwarf_on_tick?: () => void;
  _opendwarf_on_message?: (ptr: number, len: number) => void;
  _opendwarf_on_action?: (ptr: number, len: number) => void;
}

interface InstanceCtx {
  exports: WasmExports;
  ctx: GameContext | null;
}

const SUPPORTED_ABI = 1;

export async function loadWasmMod(path: string): Promise<Mod> {
  const bytes = await Deno.readFile(path);
  const slot: InstanceCtx = { exports: null as unknown as WasmExports, ctx: null };

  const imports: WebAssembly.Imports = {
    env: {
      __host_broadcast: (ptr: number, len: number) => {
        const text = readString(slot.exports.memory, ptr, len);
        slot.ctx?.broadcast(text);
      },
      __host_log: (level: number, ptr: number, len: number) => {
        const text = readString(slot.exports.memory, ptr, len);
        const log = slot.ctx?.log;
        if (!log) return;
        if (level === 2) log.error(text);
        else if (level === 1) log.warn(text);
        else log.info(text);
      },
      __host_players_list: (): bigint => {
        const players = slot.ctx?.players.list() ?? [];
        return writeJsonIntoGuest(slot.exports, players);
      },
      __host_state_get: (): bigint => {
        const state = slot.ctx?.state.get();
        if (!state) return 0n;
        return writeJsonIntoGuest(slot.exports, state);
      },
      __host_spawn: (ptr: number, len: number): bigint => {
        const args = readJson<{ kind: string; x?: number; y?: number; near?: string }>(
          slot.exports.memory,
          ptr,
          len,
        );
        const id = slot.ctx?.world.spawn(args.kind, {
          x: args.x,
          y: args.y,
          near: args.near as never,
        }) ?? "";
        return writeJsonIntoGuest(slot.exports, id);
      },
      __host_now: (): bigint => BigInt(Date.now()),
    },
  };

  const { instance } = await WebAssembly.instantiate(bytes, imports);
  slot.exports = instance.exports as unknown as WasmExports;

  const abi = slot.exports._opendwarf_abi_version();
  if (abi !== SUPPORTED_ABI) {
    throw new Error(
      `${path}: wasm mod ABI v${abi} is not supported (host expects v${SUPPORTED_ABI})`,
    );
  }

  const manifest = readPacked<ModManifest>(
    slot.exports,
    slot.exports._opendwarf_manifest(),
  );
  if (!manifest) {
    throw new Error(`${path}: _opendwarf_manifest returned no data`);
  }

  const call = <T>(
    name: keyof WasmExports,
    payload: T | undefined,
    ctx: GameContext,
  ) => {
    const fn = slot.exports[name] as
      | ((ptr: number, len: number) => void)
      | (() => void)
      | undefined;
    if (!fn) return;
    slot.ctx = ctx;
    try {
      if (payload === undefined) {
        (fn as () => void)();
      } else {
        const { ptr, len } = writeJsonIntoGuestRaw(slot.exports, payload);
        try {
          (fn as (ptr: number, len: number) => void)(ptr, len);
        } finally {
          slot.exports._opendwarf_free(ptr, len);
        }
      }
    } finally {
      slot.ctx = null;
    }
  };

  return {
    __brand: "OpenDwarfMod",
    manifest: {
      ...manifest,
      dependencies: manifest.dependencies ?? [],
    },
    definition: {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      dependencies: [...(manifest.dependencies ?? [])],

      onPlayerJoin: slot.exports._opendwarf_on_player_join
        ? (ctx, p) => call("_opendwarf_on_player_join", p, ctx)
        : undefined,
      onPlayerLeave: slot.exports._opendwarf_on_player_leave
        ? (ctx, p) => call("_opendwarf_on_player_leave", p, ctx)
        : undefined,
      onTick: slot.exports._opendwarf_on_tick
        ? (ctx) => call("_opendwarf_on_tick", undefined, ctx)
        : undefined,
      onMessage: slot.exports._opendwarf_on_message
        ? (ctx: GameContext, m: GameMessage) =>
          call("_opendwarf_on_message", m, ctx)
        : undefined,
      onAction: slot.exports._opendwarf_on_action
        ? (ctx: GameContext, a: GameAction) =>
          call("_opendwarf_on_action", a, ctx)
        : undefined,
    },
  };
}

// ---------- memory helpers ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

function readString(memory: WebAssembly.Memory, ptr: number, len: number): string {
  if (!ptr || !len) return "";
  return dec.decode(new Uint8Array(memory.buffer, ptr, len));
}

function readJson<T>(memory: WebAssembly.Memory, ptr: number, len: number): T {
  return JSON.parse(readString(memory, ptr, len)) as T;
}

function readPacked<T>(exports: WasmExports, packed: bigint): T | null {
  const ptr = Number(packed >> 32n);
  const len = Number(packed & 0xFFFFFFFFn);
  if (!ptr || !len) return null;
  const slice = new Uint8Array(exports.memory.buffer, ptr, len).slice();
  exports._opendwarf_free(ptr, len);
  return JSON.parse(dec.decode(slice)) as T;
}

function writeJsonIntoGuestRaw<T>(
  exports: WasmExports,
  value: T,
): { ptr: number; len: number } {
  const bytes = enc.encode(JSON.stringify(value));
  const ptr = exports._opendwarf_alloc(bytes.length);
  new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function writeJsonIntoGuest<T>(exports: WasmExports, value: T): bigint {
  if (value === undefined || value === null) return 0n;
  const { ptr, len } = writeJsonIntoGuestRaw(exports, value);
  return (BigInt(ptr) << 32n) | BigInt(len);
}
