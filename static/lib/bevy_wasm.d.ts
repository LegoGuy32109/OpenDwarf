/* tslint:disable */
/* eslint-disable */

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly main: (a: number, b: number) => number;
  readonly wasm_bindgen__convert__closures_____invoke__h086faf05ace3dfc8: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h18de849e6fd51a51: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__he8e1fe2d12eef0d8: (a: number, b: number, c: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hd62610ceeaefef65: (a: number, b: number, c: any, d: any) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hdfe1537bd3062b83: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h7b88d98e8d588049: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hac21ef1ad304bb08: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h46af619e8a514b6e: (a: number, b: number) => void;
  readonly wasm_bindgen__closure__destroy__h68ace84a8de0cd35: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h81c964f811bacbe4: (a: number, b: number) => number;
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
