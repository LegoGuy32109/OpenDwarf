/* tslint:disable */
/* eslint-disable */

export function flip_player_sprite_y(): void;

export function log_debug_message(): void;

export function main(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly flip_player_sprite_y: () => void;
  readonly log_debug_message: () => void;
  readonly main: () => void;
  readonly wasm_bindgen__convert__closures_____invoke__h157a9c6bfa797155: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h188859ad6b21baad: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h360d65ceb5e48527: (a: number, b: number, c: any, d: any) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h1665d2e2c4d8fe2a: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h80ad1d73f8f79bf8: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hf9b28cd2556afb82: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h2fa3d284d4e534a0: (a: number, b: number) => number;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
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
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
