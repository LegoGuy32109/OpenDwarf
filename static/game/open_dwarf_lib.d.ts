/* tslint:disable */
/* eslint-disable */

export function flip_player_sprite_y(): void;

export function log_debug_message(): void;

export function main(): void;

export type InitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly flip_player_sprite_y: () => void;
  readonly log_debug_message: () => void;
  readonly main: () => void;
  readonly __wasm_bindgen_func_elem_67679: (
    a: number,
    b: number,
    c: number,
  ) => void;
  readonly __wasm_bindgen_func_elem_67678: (a: number, b: number) => void;
  readonly __wasm_bindgen_func_elem_70905: (a: number, b: number) => void;
  readonly __wasm_bindgen_func_elem_62001: (
    a: number,
    b: number,
    c: number,
    d: number,
  ) => void;
  readonly __wasm_bindgen_func_elem_70906: (a: number, b: number) => void;
  readonly __wbindgen_export: (a: number, b: number) => number;
  readonly __wbindgen_export2: (
    a: number,
    b: number,
    c: number,
    d: number,
  ) => number;
  readonly __wbindgen_export3: (a: number) => void;
  readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(
  module: { module: SyncInitInput } | SyncInitInput,
): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<InitOutput>;
